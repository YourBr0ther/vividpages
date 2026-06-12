import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CompleteOptions, LLM, LLMCompletion } from '../src/llm/types';
import { completeStructured, extractJsonText, StructuredOutputError } from '../src/structured';

interface ScriptedResponse {
  text: string;
  tokensIn?: number;
  tokensOut?: number;
}

class FakeLLM implements LLM {
  readonly provider = 'fake';
  readonly model = 'fake-model';
  readonly calls: CompleteOptions[] = [];
  private responses: ScriptedResponse[];

  constructor(responses: ScriptedResponse[]) {
    this.responses = [...responses];
  }

  async complete(opts: CompleteOptions): Promise<LLMCompletion> {
    this.calls.push(opts);
    const next = this.responses.shift();
    if (!next) throw new Error('FakeLLM: no scripted responses left');
    return {
      text: next.text,
      tokensIn: next.tokensIn ?? 10,
      tokensOut: next.tokensOut ?? 20,
    };
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true };
  }
}

const animalSchema = z.object({
  animal: z.string(),
  legs: z.number(),
});

describe('extractJsonText', () => {
  it('returns bare JSON unchanged', () => {
    expect(extractJsonText('{"a":1}')).toBe('{"a":1}');
  });

  it('strips a simple fenced block', () => {
    expect(extractJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('handles a fenced block whose JSON contains a nested code fence in a string', () => {
    const inner = '{"code":"```js\\nx\\n```","a":1}';
    const text = extractJsonText('```json\n' + inner + '\n```');
    expect(JSON.parse(text)).toEqual({ code: '```js\nx\n```', a: 1 });
  });

  it('extracts JSON when prose before it contains braces', () => {
    const raw = 'Per the shape {name, legs} you asked for: {"animal":"spider","legs":8}';
    expect(JSON.parse(extractJsonText(raw))).toEqual({ animal: 'spider', legs: 8 });
  });

  it('extracts JSON wrapped in prose on both sides', () => {
    const raw = 'Sure! {"animal":"spider","legs":8} Hope that helps.';
    expect(JSON.parse(extractJsonText(raw))).toEqual({ animal: 'spider', legs: 8 });
  });

  it('falls back to the widest brace span when nothing parses', () => {
    expect(extractJsonText('junk {not json} junk')).toBe('{not json}');
  });

  it('returns the raw text when there are no braces at all', () => {
    expect(extractJsonText('no json here')).toBe('no json here');
  });
});

describe('completeStructured', () => {
  it('returns parsed value on first valid response', async () => {
    const llm = new FakeLLM([{ text: '{"animal":"spider","legs":8}' }]);
    const result = await completeStructured(llm, {
      prompt: 'Describe a spider',
      schema: animalSchema,
    });
    expect(result.value).toEqual({ animal: 'spider', legs: 8 });
    expect(result.attempts).toBe(1);
  });

  it('appends schema-derived JSON instructions and "Return ONLY JSON" to the prompt', async () => {
    const llm = new FakeLLM([{ text: '{"animal":"spider","legs":8}' }]);
    await completeStructured(llm, {
      prompt: 'Describe a spider',
      schema: animalSchema,
    });
    const sent = llm.calls[0]!;
    expect(sent.prompt).toContain('Describe a spider');
    // Schema fields must be communicated to the model.
    expect(sent.prompt).toContain('animal');
    expect(sent.prompt).toContain('legs');
    expect(sent.prompt).toMatch(/Return ONLY JSON/);
  });

  it('passes json:true plus temperature/maxTokens/system through to llm.complete', async () => {
    const llm = new FakeLLM([{ text: '{"animal":"spider","legs":8}' }]);
    await completeStructured(llm, {
      system: 'You are precise.',
      prompt: 'Describe a spider',
      schema: animalSchema,
      temperature: 0.1,
      maxTokens: 256,
    });
    const sent = llm.calls[0]!;
    expect(sent.json).toBe(true);
    expect(sent.system).toBe('You are precise.');
    expect(sent.temperature).toBe(0.1);
    expect(sent.maxTokens).toBe(256);
  });

  it('strips markdown fences from the response', async () => {
    const llm = new FakeLLM([
      { text: '```json\n{"animal":"spider","legs":8}\n```' },
    ]);
    const result = await completeStructured(llm, {
      prompt: 'Describe a spider',
      schema: animalSchema,
    });
    expect(result.value).toEqual({ animal: 'spider', legs: 8 });
  });

  it('extracts first-{ to last-} when JSON is wrapped in prose', async () => {
    const llm = new FakeLLM([
      { text: 'Sure! Here you go: {"animal":"spider","legs":8} Hope that helps.' },
    ]);
    const result = await completeStructured(llm, {
      prompt: 'Describe a spider',
      schema: animalSchema,
    });
    expect(result.value).toEqual({ animal: 'spider', legs: 8 });
  });

  it('retries on zod validation failure with a repair prompt containing previous response and zod errors', async () => {
    const bad = '{"animal":"spider","legs":"eight"}';
    const llm = new FakeLLM([
      { text: bad },
      { text: '{"animal":"spider","legs":8}' },
    ]);
    const result = await completeStructured(llm, {
      prompt: 'Describe a spider',
      schema: animalSchema,
    });
    expect(result.attempts).toBe(2);
    expect(result.value).toEqual({ animal: 'spider', legs: 8 });

    const repair = llm.calls[1]!;
    expect(repair.prompt).toContain('failed validation');
    // Must include the previous (bad) response verbatim.
    expect(repair.prompt).toContain(bad);
    // Must include flattened zod error text (field name and/or message).
    expect(repair.prompt).toContain('legs');
    expect(repair.prompt).toMatch(/Return ONLY the corrected JSON/);
  });

  it('retries on JSON.parse failure with a "not valid JSON" repair prompt', async () => {
    const bad = '{"animal": "spider", legs: }';
    const llm = new FakeLLM([
      { text: bad },
      { text: '{"animal":"spider","legs":8}' },
    ]);
    const result = await completeStructured(llm, {
      prompt: 'Describe a spider',
      schema: animalSchema,
    });
    expect(result.attempts).toBe(2);
    const repair = llm.calls[1]!;
    expect(repair.prompt).toContain('not valid JSON');
    expect(repair.prompt).toContain(bad);
  });

  it('accumulates tokens across attempts', async () => {
    const llm = new FakeLLM([
      { text: 'garbage', tokensIn: 100, tokensOut: 50 },
      { text: '{"animal":"spider","legs":8}', tokensIn: 200, tokensOut: 75 },
    ]);
    const result = await completeStructured(llm, {
      prompt: 'Describe a spider',
      schema: animalSchema,
    });
    expect(result.tokensIn).toBe(300);
    expect(result.tokensOut).toBe(125);
  });

  it('throws StructuredOutputError after maxAttempts with attempts, lastErrors and lastText', async () => {
    const llm = new FakeLLM([
      { text: '{"animal":"spider","legs":"a"}' },
      { text: '{"animal":"spider","legs":"b"}' },
    ]);
    const err = await completeStructured(llm, {
      prompt: 'Describe a spider',
      schema: animalSchema,
      maxAttempts: 2,
    }).then(
      () => {
        throw new Error('expected rejection');
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(StructuredOutputError);
    const soe = err as StructuredOutputError;
    expect(soe.attempts).toBe(2);
    expect(soe.lastText).toBe('{"animal":"spider","legs":"b"}');
    expect(soe.lastErrors).toBeTruthy();
    expect(JSON.stringify(soe.lastErrors)).toContain('legs');
    expect(llm.calls).toHaveLength(2);
  });

  it('clamps maxAttempts to at least 1', async () => {
    const llm = new FakeLLM([{ text: 'not json' }]);
    const err = await completeStructured(llm, {
      prompt: 'Describe a spider',
      schema: animalSchema,
      maxAttempts: 0,
    }).then(
      () => {
        throw new Error('expected rejection');
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(StructuredOutputError);
    expect((err as StructuredOutputError).attempts).toBe(1);
    expect(llm.calls).toHaveLength(1);
  });

  it('truncates a huge previous response in the repair prompt', async () => {
    const huge = `prefix ${'x'.repeat(10_000)} suffix`;
    const llm = new FakeLLM([{ text: huge }, { text: '{"animal":"spider","legs":8}' }]);
    await completeStructured(llm, {
      prompt: 'Describe a spider',
      schema: animalSchema,
    });
    const repair = llm.calls[1]!.prompt;
    expect(repair).not.toContain(huge);
    expect(repair).toContain('[... truncated');
    // The repair prompt stays bounded (~base prompt + 2k excerpt).
    expect(repair.length).toBeLessThan(4_000);
  });

  it('truncates lastText in the StructuredOutputError message but keeps it whole on the property', async () => {
    const huge = '['.repeat(10_000);
    const llm = new FakeLLM([{ text: huge }]);
    const err = await completeStructured(llm, {
      prompt: 'Describe a spider',
      schema: animalSchema,
      maxAttempts: 1,
    }).then(
      () => {
        throw new Error('expected rejection');
      },
      (e: unknown) => e,
    );
    const soe = err as StructuredOutputError;
    expect(soe).toBeInstanceOf(StructuredOutputError);
    expect(soe.lastText).toBe(huge);
    expect(soe.message).toContain('[... truncated');
    expect(soe.message.length).toBeLessThan(4_000);
  });

  it('defaults maxAttempts to 3', async () => {
    const llm = new FakeLLM([
      { text: 'nope' },
      { text: 'still nope' },
      { text: 'never json' },
    ]);
    const err = await completeStructured(llm, {
      prompt: 'Describe a spider',
      schema: animalSchema,
    }).then(
      () => {
        throw new Error('expected rejection');
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(StructuredOutputError);
    expect((err as StructuredOutputError).attempts).toBe(3);
    expect(llm.calls).toHaveLength(3);
  });
});

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OllamaLLM } from '../src/llm/ollama';
import { completeStructured } from '../src/structured';

const OLLAMA_URL = process.env.OLLAMA_URL;
const MODEL = process.env.OLLAMA_MODEL ?? 'llama3.1:8b';

describe.skipIf(!OLLAMA_URL)('Ollama integration', () => {
  const llm = () => new OllamaLLM({ baseUrl: OLLAMA_URL!, model: MODEL });

  it('healthCheck reports server status and model availability', async () => {
    const health = await llm().healthCheck();
    if (!health.ok) {
      console.warn(
        `[ollama.integration] model '${MODEL}' not ready: ${health.detail}`,
      );
      expect(health.ok).toBe(false);
      expect(health.detail).toBeTruthy();
    } else {
      expect(health.ok).toBe(true);
    }
  });

  it('completeStructured returns schema-valid JSON from the real model', async (ctx) => {
    const health = await llm().healthCheck();
    if (!health.ok) {
      console.warn(
        `[ollama.integration] skipping completion test: ${health.detail}`,
      );
      ctx.skip();
      return;
    }

    const schema = z.object({ animal: z.string(), legs: z.number() });
    const result = await completeStructured(llm(), {
      prompt: 'Return JSON describing a spider.',
      schema,
      temperature: 0,
      maxTokens: 200,
    });

    expect(typeof result.value.animal).toBe('string');
    expect(typeof result.value.legs).toBe('number');
    expect(result.attempts).toBeGreaterThanOrEqual(1);
    expect(result.tokensIn).toBeGreaterThan(0);
    expect(result.tokensOut).toBeGreaterThan(0);
  }, 180_000);
});

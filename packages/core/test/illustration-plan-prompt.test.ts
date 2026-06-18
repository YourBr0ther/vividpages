import { describe, expect, it } from 'vitest';

import {
  buildIllustrationPlanPrompt,
  MAX_PLAN_CHAPTER_CHARS,
  PLAN_FIDELITY_INSTRUCTION,
} from '../src/illustration/plan-prompt';

const base = {
  chapterText: 'Evie crept down the corridor, clutching the ledger.',
  roster: [
    { name: 'Evie', oneLine: 'lavender-haired assistant' },
    { name: 'Trystan', oneLine: null as string | null },
  ],
  maxMoments: 3,
  bookTitle: 'Assistant to the Villain',
};

describe('buildIllustrationPlanPrompt', () => {
  it('returns a system prompt establishing an art-director role and JSON-only output', () => {
    const { system } = buildIllustrationPlanPrompt(base);
    expect(system).toMatch(/art[- ]director/i);
    expect(system).toMatch(/ONLY.*JSON|JSON.*only/i);
  });

  it('embeds the book title', () => {
    const { prompt } = buildIllustrationPlanPrompt(base);
    expect(prompt).toContain('Assistant to the Villain');
  });

  it('embeds the maxMoments cap', () => {
    const { prompt } = buildIllustrationPlanPrompt(base);
    expect(prompt).toContain('3');
  });

  it('renders roster lines as "Name — oneLine"', () => {
    const { prompt } = buildIllustrationPlanPrompt(base);
    expect(prompt).toContain('Evie — lavender-haired assistant');
    expect(prompt).toContain('Trystan');
  });

  it('instructs the model to anchor each moment to a verbatim sentence', () => {
    const { prompt } = buildIllustrationPlanPrompt(base);
    expect(prompt).toMatch(/verbatim/i);
  });

  it('instructs the model to spread moments across the chapter', () => {
    const { prompt } = buildIllustrationPlanPrompt(base);
    expect(prompt).toMatch(/spread/i);
  });

  it('instructs the model about narrative vs front/back matter', () => {
    const { prompt } = buildIllustrationPlanPrompt(base);
    expect(prompt).toMatch(/narrative/i);
  });

  it('prefers concrete action/setting/character over pure dialogue', () => {
    const { prompt } = buildIllustrationPlanPrompt(base);
    expect(prompt).toMatch(/dialogue/i);
  });

  it('instructs the planner to describe concrete physical staging, not the topic', () => {
    const { prompt } = buildIllustrationPlanPrompt(base);
    expect(prompt).toMatch(/physical staging|staging/i);
    // It must contrast the topic/abstract against the bodies/action.
    expect(prompt).toMatch(/bodies|doing|spatial/i);
  });

  it('includes a weak-vs-strong few-shot example contrasting topic and staging', () => {
    const { prompt } = buildIllustrationPlanPrompt(base);
    // The canonical contrast pair from the design doc.
    expect(prompt).toMatch(/weak/i);
    expect(prompt).toMatch(/strong/i);
    expect(prompt).toContain('confronts Evie about the letter');
    expect(prompt).toContain('looms over the desk');
  });

  it('fences the chapter text', () => {
    const { prompt } = buildIllustrationPlanPrompt(base);
    expect(prompt).toMatch(/```\n?Evie crept down the corridor[\s\S]*?```/);
  });

  it('passes chapter text through untouched when under the length cap', () => {
    const { prompt } = buildIllustrationPlanPrompt(base);
    expect(prompt).toContain(base.chapterText);
    expect(prompt).not.toContain('[... omitted ...]');
  });

  it('sends a typical full-length chapter (~40k chars) untruncated', () => {
    // A real chapter (e.g. the 32k-char Prologue) easily fits the model's
    // context; only pathologically huge chapters should be clipped.
    const head = 'HEAD-MARKER. ';
    const tail = ' TAIL-MARKER.';
    const chapterText = head + 'x'.repeat(40_000) + tail;
    const { prompt } = buildIllustrationPlanPrompt({ ...base, chapterText });
    expect(prompt).toContain(chapterText);
    expect(prompt).not.toContain('[... omitted ...]');
  });

  it('truncates the middle of a pathologically huge chapter, keeping head and tail', () => {
    const head = 'HEAD-MARKER. ';
    const tail = ' TAIL-MARKER.';
    const chapterText = head + 'x'.repeat(MAX_PLAN_CHAPTER_CHARS * 2) + tail;
    const { prompt } = buildIllustrationPlanPrompt({ ...base, chapterText });
    expect(prompt).toContain('HEAD-MARKER');
    expect(prompt).toContain('TAIL-MARKER');
    expect(prompt).toContain('[... omitted ...]');
    expect(prompt.length).toBeLessThan(MAX_PLAN_CHAPTER_CHARS + 4_000);
  });

  it('handles an empty roster', () => {
    const { prompt } = buildIllustrationPlanPrompt({ ...base, roster: [] });
    expect(prompt).toMatch(/no characters|none/i);
  });

  describe('mature-content fidelity', () => {
    const offPath = buildIllustrationPlanPrompt(base);

    it('produces byte-identical output to current when mature is absent', () => {
      expect(buildIllustrationPlanPrompt(base)).toEqual(offPath);
    });

    it('produces byte-identical output to the absent case when mature is false', () => {
      expect(buildIllustrationPlanPrompt({ ...base, mature: false })).toEqual(offPath);
    });

    it('does not include the fidelity instruction when mature is off', () => {
      const off = buildIllustrationPlanPrompt({ ...base, mature: false });
      expect(off.system).not.toContain(PLAN_FIDELITY_INSTRUCTION);
      expect(off.prompt).not.toContain(PLAN_FIDELITY_INSTRUCTION);
    });

    it('includes the fidelity instruction when mature is on', () => {
      const on = buildIllustrationPlanPrompt({ ...base, mature: true });
      const combined = `${on.system}\n${on.prompt}`;
      expect(combined).toContain(PLAN_FIDELITY_INSTRUCTION);
    });

    it('the fidelity instruction frames mature beats as legitimate visual moments', () => {
      expect(PLAN_FIDELITY_INSTRUCTION).toMatch(/legitimate/i);
      expect(PLAN_FIDELITY_INSTRUCTION).toMatch(/skip|soften/i);
    });

    it('is deterministic on the mature path', () => {
      const a = buildIllustrationPlanPrompt({ ...base, mature: true });
      const b = buildIllustrationPlanPrompt({ ...base, mature: true });
      expect(a).toEqual(b);
    });

    it('still keeps the existing planning instructions on the mature path', () => {
      const { prompt } = buildIllustrationPlanPrompt({ ...base, mature: true });
      expect(prompt).toMatch(/verbatim/i);
      expect(prompt).toMatch(/spread/i);
      expect(prompt).toContain('Assistant to the Villain');
    });
  });
});

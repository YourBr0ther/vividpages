import { describe, expect, it } from 'vitest';

import {
  buildIllustrationPlanPrompt,
  MAX_PLAN_CHAPTER_CHARS,
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

  it('fences the chapter text', () => {
    const { prompt } = buildIllustrationPlanPrompt(base);
    expect(prompt).toMatch(/```\n?Evie crept down the corridor[\s\S]*?```/);
  });

  it('passes chapter text through untouched when under the length cap', () => {
    const { prompt } = buildIllustrationPlanPrompt(base);
    expect(prompt).toContain(base.chapterText);
    expect(prompt).not.toContain('[... omitted ...]');
  });

  it('truncates the middle of an over-long chapter, keeping head and tail', () => {
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
});

import { describe, expect, it } from 'vitest';

import {
  buildProfilePrompt,
  MAX_PROFILE_MENTIONS,
  selectInformativeMentions,
  type ProfileMention,
} from '../src/analysis/profile-prompt';

const mention = (over: Partial<ProfileMention> = {}): ProfileMention => ({
  sceneGlobalIdx: 0,
  descriptionDelta: 'lavender hair pinned up',
  stateChanges: null,
  ...over,
});

const baseArgs = {
  name: 'Evie',
  aliases: ['Evangelina Sage'],
  sceneCount: 85,
  totalScenes: 101,
  mentions: [
    mention({ sceneGlobalIdx: 0, descriptionDelta: 'lavender hair pinned up' }),
    mention({
      sceneGlobalIdx: 4,
      descriptionDelta: 'hazel eyes, ink-stained fingers',
      stateChanges: { note: 'wearing a practical work dress' },
    }),
  ],
};

describe('selectInformativeMentions', () => {
  it('drops mentions with neither a descriptionDelta nor stateChanges', () => {
    const kept = selectInformativeMentions([
      mention({ sceneGlobalIdx: 0, descriptionDelta: null }),
      mention({ sceneGlobalIdx: 1, descriptionDelta: 'scar over one eyebrow' }),
      mention({ sceneGlobalIdx: 2, descriptionDelta: null, stateChanges: { note: 'bleeding' } }),
    ]);
    expect(kept.map((m) => m.sceneGlobalIdx)).toEqual([1, 2]);
  });

  it('returns everything when at or under the cap', () => {
    const mentions = Array.from({ length: MAX_PROFILE_MENTIONS }, (_, i) =>
      mention({ sceneGlobalIdx: i, descriptionDelta: `detail ${i}` }),
    );
    expect(selectInformativeMentions(mentions)).toHaveLength(MAX_PROFILE_MENTIONS);
  });

  it('caps to the first occurrence plus the longest mentions, in scene order', () => {
    // First mention is the shortest; it must survive the cap anyway.
    const first = mention({ sceneGlobalIdx: 0, descriptionDelta: 'x' });
    const rest = Array.from({ length: 60 }, (_, i) =>
      mention({
        sceneGlobalIdx: i + 1,
        // Length grows with the index, so the LAST 39 are the longest.
        descriptionDelta: 'd'.repeat(i + 2),
      }),
    );
    const kept = selectInformativeMentions([first, ...rest]);

    expect(kept).toHaveLength(MAX_PROFILE_MENTIONS);
    expect(kept[0]).toBe(first);
    // The longest mention survives; a short middle one does not.
    expect(kept.some((m) => m.sceneGlobalIdx === 60)).toBe(true);
    expect(kept.some((m) => m.sceneGlobalIdx === 5)).toBe(false);
    // Scene order is preserved after selection.
    const order = kept.map((m) => m.sceneGlobalIdx);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe('buildProfilePrompt', () => {
  it('embeds the character name, aliases and mention details', () => {
    const { prompt } = buildProfilePrompt(baseArgs);
    expect(prompt).toContain('Evie');
    expect(prompt).toContain('Evangelina Sage');
    expect(prompt).toContain('lavender hair pinned up');
    expect(prompt).toContain('hazel eyes, ink-stained fingers');
    expect(prompt).toContain('wearing a practical work dress');
  });

  it('includes sceneCount and role guidance', () => {
    const { prompt } = buildProfilePrompt(baseArgs);
    expect(prompt).toContain('85');
    for (const role of ['main', 'minor']) {
      expect(prompt).toContain(`'${role}'`);
    }
  });

  it('gives oneLine as a slot template, not a copyable concrete example', () => {
    const { prompt } = buildProfilePrompt(baseArgs);
    // Placeholders force the model to fill from the text...
    expect(prompt).toContain('<hair> hair');
    expect(prompt).toContain('Never output the placeholder words');
    // ...and the old concrete example that leaked "lavender hair + work dress"
    // onto under-described characters across books must be gone.
    expect(prompt).not.toContain('lavender hair and ink-stained fingers');
  });

  it('restricts distinguishing features to permanent traits', () => {
    const { prompt } = buildProfilePrompt(baseArgs);
    expect(prompt).toMatch(/permanent/i);
    expect(prompt).toMatch(/exclude temporary/i);
  });

  it('instructs a single canonical visual profile with nulls for undescribed traits', () => {
    const { system, prompt } = buildProfilePrompt(baseArgs);
    const all = `${system}\n${prompt}`;
    expect(all).toMatch(/one canonical/i);
    expect(all).toMatch(/physical|visual/i);
    expect(all).toMatch(/null/);
    expect(all).toMatch(/image prompt/i);
  });

  it('caps embedded mentions at MAX_PROFILE_MENTIONS', () => {
    const mentions = Array.from({ length: 80 }, (_, i) =>
      mention({ sceneGlobalIdx: i, descriptionDelta: `detail-${i}-end ${'pad '.repeat(i)}` }),
    );
    const { prompt } = buildProfilePrompt({ ...baseArgs, mentions });
    const embedded = mentions.filter((m) => prompt.includes(`detail-${m.sceneGlobalIdx}-end`));
    expect(embedded).toHaveLength(MAX_PROFILE_MENTIONS);
  });

  it('handles characters with no informative mentions', () => {
    const { prompt } = buildProfilePrompt({
      ...baseArgs,
      mentions: [mention({ descriptionDelta: null })],
    });
    expect(prompt).toMatch(/no explicit visual description/i);
  });
});

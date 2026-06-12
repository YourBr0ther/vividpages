import { describe, expect, it } from 'vitest';

import type { CharacterProfile } from '../src/analysis/profile-schema';
import {
  buildPortraitPrompt,
  buildScenePrompt,
  NEGATIVE_BASE,
  renderCharacterDescription,
  type CharacterForPrompt,
  type SceneForPrompt,
  type StyleFragment,
} from '../src/imaging/prompt';

const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;

const profile = (overrides: Partial<CharacterProfile>): CharacterProfile => ({
  hair: null,
  eyes: null,
  skin: null,
  build: null,
  age: null,
  attire: null,
  distinguishing: null,
  oneLine: 'a character',
  role: 'supporting',
  ...overrides,
});

const evie: CharacterForPrompt = {
  name: 'Evie',
  appearanceToken: 'Evie: young woman, lavender, practical work dress',
  profile: profile({
    age: 'young woman',
    build: 'slender',
    hair: 'lavender',
    eyes: 'hazel',
    attire: 'practical work dress',
    distinguishing: 'ink-stained fingers',
  }),
};

const painterly: StyleFragment = {
  promptFragment:
    'richly detailed digital painting, fantasy book illustration, painterly brushwork, dramatic lighting, muted jewel tones',
  negativeFragment: 'photo, photorealistic, text, watermark, signature, frame, border',
};

describe('renderCharacterDescription', () => {
  it('renders labeled traits from the profile in stable order', () => {
    expect(renderCharacterDescription(evie)).toBe(
      'young woman, slender build, lavender hair, hazel eyes, wearing a practical work dress, ink-stained fingers',
    );
  });

  it('suffixes single-word hair and eye values with their label', () => {
    const c: CharacterForPrompt = {
      name: 'Tom',
      appearanceToken: null,
      profile: profile({ hair: 'dark', eyes: 'grey' }),
    };
    expect(renderCharacterDescription(c)).toBe('dark hair, grey eyes');
  });

  it('does not double a label the value already contains', () => {
    const c: CharacterForPrompt = {
      name: 'Tom',
      appearanceToken: null,
      profile: profile({ hair: 'long lavender hair', eyes: 'hazel eyes', build: 'wiry build' }),
    };
    expect(renderCharacterDescription(c)).toBe('wiry build, long lavender hair, hazel eyes');
  });

  it('phrases attire with "wearing"', () => {
    const c: CharacterForPrompt = {
      name: 'Tom',
      appearanceToken: null,
      profile: profile({ attire: 'a travel-worn cloak' }),
    };
    expect(renderCharacterDescription(c)).toBe('wearing a travel-worn cloak');
  });

  it('does not double "wearing" when the attire already includes it', () => {
    const c: CharacterForPrompt = {
      name: 'Tom',
      appearanceToken: null,
      profile: profile({ attire: 'wearing chainmail' }),
    };
    expect(renderCharacterDescription(c)).toBe('wearing chainmail');
  });

  it('falls back to the appearance token without the name prefix', () => {
    const c: CharacterForPrompt = {
      name: 'Evie',
      appearanceToken: 'Evie: young woman, lavender hair, practical work dress',
      profile: null,
    };
    expect(renderCharacterDescription(c)).toBe(
      'young woman, lavender hair, practical work dress',
    );
  });

  it('falls back to the appearance token when the profile has no visual traits', () => {
    const c: CharacterForPrompt = {
      name: 'Evie',
      appearanceToken: 'Evie: young woman, lavender hair',
      profile: profile({}),
    };
    expect(renderCharacterDescription(c)).toBe('young woman, lavender hair');
  });

  it('falls back to the name alone when there is nothing else', () => {
    const c: CharacterForPrompt = { name: 'Evie', appearanceToken: null, profile: null };
    expect(renderCharacterDescription(c)).toBe('Evie');
  });

  it('treats a name-only appearance token as empty', () => {
    const c: CharacterForPrompt = { name: 'Evie', appearanceToken: 'Evie', profile: null };
    expect(renderCharacterDescription(c)).toBe('Evie');
  });
});

describe('buildPortraitPrompt', () => {
  it('assembles style, name, description, and framing into natural prose', () => {
    const { prompt } = buildPortraitPrompt({ character: evie, style: painterly });
    expect(prompt).toBe(
      'richly detailed digital painting, fantasy book illustration, painterly brushwork, ' +
        'dramatic lighting, muted jewel tones. Character portrait of Evie: young woman, ' +
        'slender build, lavender hair, hazel eyes, wearing a practical work dress, ' +
        'ink-stained fingers. Three-quarter view, neutral background with soft ambient ' +
        'depth, focused character study.',
    );
  });

  it('never emits double periods or double spaces', () => {
    const style: StyleFragment = {
      promptFragment: 'cinematic film still.',
      negativeFragment: 'photo.',
    };
    const { prompt } = buildPortraitPrompt({ character: evie, style });
    expect(prompt).not.toMatch(/\.\./);
    expect(prompt).not.toMatch(/ {2}/);
  });

  it('dedupes negative terms across the style fragment and the shared base', () => {
    const { negative } = buildPortraitPrompt({ character: evie, style: painterly });
    const terms = negative.split(', ');
    expect(new Set(terms).size).toBe(terms.length);
    // Style terms survive, base terms appended, shared terms appear once.
    expect(terms).toContain('photorealistic');
    expect(terms).toContain('deformed');
    expect(terms.filter((t) => t === 'text')).toHaveLength(1);
    expect(terms.filter((t) => t === 'watermark')).toHaveLength(1);
  });

  it('includes every base negative term', () => {
    const { negative } = buildPortraitPrompt({ character: evie, style: painterly });
    for (const term of NEGATIVE_BASE.split(', ')) {
      expect(negative.split(', ')).toContain(term);
    }
  });
});

const fullScene: SceneForPrompt = {
  summary: 'Evie confronts the villain in his study.',
  setting: 'a candlelit study lined with stolen artifacts',
  timeOfDay: 'evening',
  mood: 'tense',
  keyVisualMoment: 'Evie slams the ledger onto the desk as candle flames gutter',
};

describe('buildScenePrompt', () => {
  it('prefers the key visual moment over the summary', () => {
    const { prompt } = buildScenePrompt({ scene: fullScene, characters: [], style: painterly });
    expect(prompt).toContain('Evie slams the ledger onto the desk as candle flames gutter');
    expect(prompt).not.toContain('confronts the villain');
  });

  it('uses the summary when there is no key visual moment', () => {
    const { prompt } = buildScenePrompt({
      scene: { ...fullScene, keyVisualMoment: null },
      characters: [],
      style: painterly,
    });
    expect(prompt).toContain('Evie confronts the villain in his study');
  });

  it('includes setting, light, and mood lines', () => {
    const { prompt } = buildScenePrompt({ scene: fullScene, characters: [], style: painterly });
    expect(prompt).toContain('Setting: a candlelit study lined with stolen artifacts.');
    expect(prompt).toContain('evening light, tense mood.');
  });

  it('lists characters with their descriptions', () => {
    const { prompt } = buildScenePrompt({
      scene: fullScene,
      characters: [evie],
      style: painterly,
    });
    expect(prompt).toContain(
      'Characters present: Evie (young woman, slender build, lavender hair, hazel eyes, ' +
        'wearing a practical work dress, ink-stained fingers).',
    );
  });

  it('caps the character list at the first three', () => {
    const characters = ['Evie', 'Tom', 'Mara', 'Quill', 'Hess'].map((name) => ({
      name,
      appearanceToken: null,
      profile: null,
    }));
    const { prompt } = buildScenePrompt({ scene: fullScene, characters, style: painterly });
    expect(prompt).toContain('Evie');
    expect(prompt).toContain('Tom');
    expect(prompt).toContain('Mara');
    expect(prompt).not.toContain('Quill');
    expect(prompt).not.toContain('Hess');
  });

  it('caps each character description at 25 words', () => {
    const longToken =
      'Tom: ' +
      Array.from({ length: 60 }, (_, i) => `trait${i}`).join(', ');
    const tom: CharacterForPrompt = { name: 'Tom', appearanceToken: longToken, profile: null };
    const { prompt } = buildScenePrompt({ scene: fullScene, characters: [tom], style: painterly });
    const match = prompt.match(/Tom \(([^)]*)\)/);
    expect(match).not.toBeNull();
    expect(wordCount(match?.[1] ?? '')).toBeLessThanOrEqual(25);
  });

  it('drops character descriptions before the setting under length pressure', () => {
    const wordy = (n: number, p: string) =>
      Array.from({ length: n }, (_, i) => `${p}${i}`).join(' ');
    const scene: SceneForPrompt = {
      ...fullScene,
      keyVisualMoment: wordy(100, 'moment'),
      setting: wordy(40, 'place'),
    };
    const characters: CharacterForPrompt[] = [
      { name: 'Evie', appearanceToken: `Evie: ${wordy(20, 'evie')}`, profile: null },
      { name: 'Tom', appearanceToken: `Tom: ${wordy(20, 'tom')}`, profile: null },
    ];
    const { prompt } = buildScenePrompt({ scene, characters, style: painterly });
    // Over budget: descriptions dropped, names and setting retained.
    expect(prompt).toContain('Characters present: Evie; Tom.');
    expect(prompt).not.toContain('evie0');
    expect(prompt).toContain('Setting:');
    expect(prompt).toContain('moment99');
  });

  it('drops the setting line after descriptions, but never the key moment', () => {
    const wordy = (n: number, p: string) =>
      Array.from({ length: n }, (_, i) => `${p}${i}`).join(' ');
    const scene: SceneForPrompt = {
      ...fullScene,
      keyVisualMoment: wordy(175, 'moment'),
      setting: wordy(40, 'place'),
    };
    const { prompt } = buildScenePrompt({ scene, characters: [evie], style: painterly });
    expect(prompt).not.toContain('Setting:');
    expect(prompt).toContain('moment174');
  });

  it('falls back to a quiet narrative moment when every field is null', () => {
    const empty: SceneForPrompt = {
      summary: null,
      setting: null,
      timeOfDay: null,
      mood: null,
      keyVisualMoment: null,
    };
    const { prompt } = buildScenePrompt({ scene: empty, characters: [], style: painterly });
    expect(prompt).toContain('A quiet narrative moment.');
    expect(prompt).not.toMatch(/\.\./);
    expect(prompt).not.toMatch(/ {2}/);
  });

  it('omits light/mood fragments independently when null', () => {
    const { prompt: noMood } = buildScenePrompt({
      scene: { ...fullScene, mood: null },
      characters: [],
      style: painterly,
    });
    expect(noMood).toContain('evening light.');
    expect(noMood).not.toContain('mood');

    const { prompt: noTime } = buildScenePrompt({
      scene: { ...fullScene, timeOfDay: null },
      characters: [],
      style: painterly,
    });
    expect(noTime).toContain('tense mood.');
    expect(noTime).not.toContain('light,');
  });

  it('is deterministic: identical input yields byte-identical output', () => {
    const a = buildScenePrompt({ scene: { ...fullScene }, characters: [{ ...evie }], style: { ...painterly } });
    const b = buildScenePrompt({ scene: { ...fullScene }, characters: [{ ...evie }], style: { ...painterly } });
    expect(a).toEqual(b);
    expect(a.prompt).toBe(b.prompt);
    expect(a.negative).toBe(b.negative);
  });

  it('shares the deduped negative with portraits', () => {
    const scene = buildScenePrompt({ scene: fullScene, characters: [], style: painterly });
    const portrait = buildPortraitPrompt({ character: evie, style: painterly });
    expect(scene.negative).toBe(portrait.negative);
  });
});

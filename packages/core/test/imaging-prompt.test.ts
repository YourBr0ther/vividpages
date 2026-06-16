import { describe, expect, it } from 'vitest';

import type { CharacterProfile } from '../src/analysis/profile-schema';
import {
  buildPortraitPrompt,
  buildScenePrompt,
  lightingFor,
  MAX_SCENE_CHARACTERS,
  MAX_SCENE_PROMPT_WORDS,
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

const tom: CharacterForPrompt = {
  name: 'Tom',
  appearanceToken: 'Tom: weathered man, broad-shouldered, grey beard',
  profile: profile({
    age: 'weathered man',
    build: 'broad-shouldered',
    hair: 'cropped grey',
    eyes: 'grey',
    attire: 'a travel-worn cloak',
    distinguishing: 'grey beard',
  }),
};

const painterly: StyleFragment = {
  promptFragment:
    'richly detailed digital painting, fantasy book illustration, painterly brushwork, dramatic lighting, muted jewel tones',
  negativeFragment: 'photo, photorealistic, text, watermark, signature, frame, border',
};

const TECHNICAL_CLAUSE = 'No text, watermarks, or logos.';

/** A populated prose prompt reads as sentences, not a comma-only tag list. */
const looksLikeProse = (prompt: string): void => {
  // At least two sentence-ending periods (more than one full sentence).
  expect((prompt.match(/\./g) ?? []).length).toBeGreaterThanOrEqual(2);
  // No tag-soup artifacts.
  expect(prompt).not.toMatch(/\.\./);
  expect(prompt).not.toMatch(/ {2}/);
  expect(prompt).not.toMatch(/ ,/);
  // Ends with the technical constraint clause.
  expect(prompt.trimEnd().endsWith(TECHNICAL_CLAUSE)).toBe(true);
};

describe('lightingFor', () => {
  it('maps each known time of day to an explicit lighting phrase', () => {
    expect(lightingFor('morning')).toBe('soft morning light');
    expect(lightingFor('afternoon')).toBe('bright afternoon daylight');
    expect(lightingFor('evening')).toBe('warm golden-hour light');
    expect(lightingFor('night')).toBe('dim, low-key moonlit night lighting');
    expect(lightingFor('dawn')).toBe('pale, cool dawn light');
    expect(lightingFor('dusk')).toBe('fading violet dusk light');
    expect(lightingFor('midday')).toBe('bright midday sunlight');
  });

  it('is case- and whitespace-insensitive on the enum', () => {
    expect(lightingFor('  Evening ')).toBe('warm golden-hour light');
    expect(lightingFor('NIGHT')).toBe('dim, low-key moonlit night lighting');
  });

  it('falls back to natural, even lighting for null or unknown values', () => {
    expect(lightingFor(null)).toBe('natural, even lighting');
    expect(lightingFor('')).toBe('natural, even lighting');
    expect(lightingFor('sometime')).toBe('natural, even lighting');
  });
});

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
    expect(renderCharacterDescription(c)).toBe('young woman, lavender hair, practical work dress');
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
  it('returns an empty negative (inert on Z-Image Turbo)', () => {
    const { negative } = buildPortraitPrompt({ character: evie, style: painterly });
    expect(negative).toBe('');
  });

  it('emits camera-structured natural-language prose, not a tag list', () => {
    const { prompt } = buildPortraitPrompt({ character: evie, style: painterly });
    looksLikeProse(prompt);
    // Scaffold landmarks: a framed portrait shot of the subject.
    expect(prompt).toMatch(/three-quarter (character )?portrait of Evie/i);
    // Neutral studio framing + studio lighting language.
    expect(prompt.toLowerCase()).toContain('studio');
  });

  it('preserves the appearance description substance verbatim', () => {
    const { prompt } = buildPortraitPrompt({ character: evie, style: painterly });
    expect(prompt).toContain(
      'young woman, slender build, lavender hair, hazel eyes, wearing a practical work dress, ink-stained fingers',
    );
  });

  it('weaves the style preset promptFragment in as the medium/style', () => {
    const { prompt } = buildPortraitPrompt({ character: evie, style: painterly });
    expect(prompt).toContain(painterly.promptFragment);
  });

  it('does not rely on the style negativeFragment', () => {
    const { prompt, negative } = buildPortraitPrompt({ character: evie, style: painterly });
    expect(negative).toBe('');
    // The negative-only terms ('signature', 'frame', 'border') are not folded in.
    expect(prompt).not.toContain('signature');
    expect(prompt).not.toContain('border');
  });

  it('never emits double periods or double spaces, even with messy style input', () => {
    const style: StyleFragment = {
      promptFragment: 'cinematic film still.',
      negativeFragment: 'photo.',
    };
    const { prompt } = buildPortraitPrompt({ character: evie, style });
    expect(prompt).not.toMatch(/\.\./);
    expect(prompt).not.toMatch(/ {2}/);
  });

  it('is deterministic: identical input yields byte-identical output', () => {
    const a = buildPortraitPrompt({ character: { ...evie }, style: { ...painterly } });
    const b = buildPortraitPrompt({ character: { ...evie }, style: { ...painterly } });
    expect(a).toEqual(b);
  });

  it('still produces coherent prose when the character is name-only', () => {
    const c: CharacterForPrompt = { name: 'Quill', appearanceToken: null, profile: null };
    const { prompt } = buildPortraitPrompt({ character: c, style: painterly });
    looksLikeProse(prompt);
    expect(prompt).toContain('Quill');
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
  it('returns an empty negative (inert on Z-Image Turbo)', () => {
    const { negative } = buildScenePrompt({ scene: fullScene, characters: [], style: painterly });
    expect(negative).toBe('');
  });

  it('emits camera-structured natural-language prose ending in the technical clause', () => {
    const { prompt } = buildScenePrompt({
      scene: fullScene,
      characters: [evie],
      style: painterly,
    });
    looksLikeProse(prompt);
  });

  it('uses the key visual moment as the action, not the summary', () => {
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

  it('includes the setting', () => {
    const { prompt } = buildScenePrompt({ scene: fullScene, characters: [], style: painterly });
    expect(prompt).toContain('a candlelit study lined with stolen artifacts');
  });

  it('derives explicit lighting from timeOfDay', () => {
    const { prompt } = buildScenePrompt({ scene: fullScene, characters: [], style: painterly });
    expect(prompt).toContain(lightingFor('evening'));
    expect(prompt).toContain('warm golden-hour light');
  });

  it('includes the mood', () => {
    const { prompt } = buildScenePrompt({ scene: fullScene, characters: [], style: painterly });
    expect(prompt.toLowerCase()).toContain('tense');
  });

  it('weaves the style preset promptFragment in as the medium/style', () => {
    const { prompt } = buildScenePrompt({ scene: fullScene, characters: [], style: painterly });
    expect(prompt).toContain(painterly.promptFragment);
  });

  it('preserves each present character appearance substance verbatim', () => {
    const { prompt } = buildScenePrompt({
      scene: fullScene,
      characters: [evie],
      style: painterly,
    });
    expect(prompt).toContain(
      'young woman, slender build, lavender hair, hazel eyes, wearing a practical work dress, ink-stained fingers',
    );
  });

  it('names every capped character', () => {
    const { prompt } = buildScenePrompt({
      scene: fullScene,
      characters: [evie, tom],
      style: painterly,
    });
    expect(prompt).toContain('Evie');
    expect(prompt).toContain('Tom');
  });

  it(`caps the character list at MAX_SCENE_CHARACTERS (${MAX_SCENE_CHARACTERS})`, () => {
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

  it('keeps a populated scene within a sane word band', () => {
    const { prompt } = buildScenePrompt({
      scene: fullScene,
      characters: [evie, tom],
      style: painterly,
    });
    const count = wordCount(prompt);
    expect(count).toBeLessThanOrEqual(MAX_SCENE_PROMPT_WORDS);
    expect(count).toBeGreaterThanOrEqual(30);
  });

  it('drops character descriptions before the key moment under length pressure', () => {
    const wordy = (n: number, p: string) =>
      Array.from({ length: n }, (_, i) => `${p}${i}`).join(' ');
    const scene: SceneForPrompt = {
      ...fullScene,
      keyVisualMoment: wordy(150, 'moment'),
      setting: wordy(40, 'place'),
    };
    const characters: CharacterForPrompt[] = [
      { name: 'Evie', appearanceToken: `Evie: ${wordy(20, 'evie')}`, profile: null },
      { name: 'Tom', appearanceToken: `Tom: ${wordy(20, 'tom')}`, profile: null },
    ];
    const { prompt } = buildScenePrompt({ scene, characters, style: painterly });
    // Descriptions dropped, names retained, key moment kept.
    expect(prompt).not.toContain('evie0');
    expect(prompt).not.toContain('tom0');
    expect(prompt).toContain('Evie');
    expect(prompt).toContain('Tom');
    expect(prompt).toContain('moment99');
  });

  it('drops the setting after descriptions, but never the key moment', () => {
    const wordy = (n: number, p: string) =>
      Array.from({ length: n }, (_, i) => `${p}${i}`).join(' ');
    const scene: SceneForPrompt = {
      ...fullScene,
      keyVisualMoment: wordy(175, 'moment'),
      setting: wordy(40, 'place'),
    };
    const { prompt } = buildScenePrompt({ scene, characters: [evie], style: painterly });
    expect(prompt).not.toContain('place0');
    expect(prompt).toContain('moment174');
    looksLikeProse(prompt);
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
    expect(prompt).toContain('A quiet narrative moment');
    looksLikeProse(prompt);
  });

  it('uses natural even lighting when timeOfDay is null', () => {
    const { prompt } = buildScenePrompt({
      scene: { ...fullScene, timeOfDay: null },
      characters: [],
      style: painterly,
    });
    expect(prompt).toContain('natural, even lighting');
  });

  it('omits the setting clause when setting is null but stays prose', () => {
    const { prompt } = buildScenePrompt({
      scene: { ...fullScene, setting: null },
      characters: [],
      style: painterly,
    });
    expect(prompt).not.toContain('candlelit study');
    looksLikeProse(prompt);
  });

  it('omits the character clause (the "Featuring …" sentence) when there are no characters', () => {
    const { prompt } = buildScenePrompt({ scene: fullScene, characters: [], style: painterly });
    looksLikeProse(prompt);
    // No cast sentence is emitted (the key moment itself may still name people).
    expect(prompt).not.toContain('Featuring');
  });

  it('is deterministic: identical input yields byte-identical output', () => {
    const a = buildScenePrompt({
      scene: { ...fullScene },
      characters: [{ ...evie }, { ...tom }],
      style: { ...painterly },
    });
    const b = buildScenePrompt({
      scene: { ...fullScene },
      characters: [{ ...evie }, { ...tom }],
      style: { ...painterly },
    });
    expect(a).toEqual(b);
    expect(a.prompt).toBe(b.prompt);
    expect(a.negative).toBe(b.negative);
  });
});

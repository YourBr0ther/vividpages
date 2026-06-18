import { describe, expect, it } from 'vitest';

import type { CharacterProfile } from '../src/analysis/profile-schema';
import {
  buildPortraitPrompt,
  buildScenePrompt,
  framingFor,
  IMAGING_FIDELITY_INSTRUCTION,
  lightingFor,
  MAX_SCENE_CHARACTERS,
  MAX_SCENE_PROMPT_WORDS,
  renderCharacterDescription,
  shotFor,
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
  role: 'main',
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

describe('shotFor', () => {
  it('maps each known sceneType to a camera shot phrase', () => {
    expect(shotFor('dialogue')).toBe('a medium two-shot');
    expect(shotFor('action')).toBe('a dynamic wide shot from a low angle');
    expect(shotFor('description')).toBe('a wide establishing shot');
    expect(shotFor('transition')).toBe('a wide establishing shot');
    expect(shotFor('narrative')).toBe('a medium-wide shot');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(shotFor('  Dialogue ')).toBe('a medium two-shot');
    expect(shotFor('ACTION')).toBe('a dynamic wide shot from a low angle');
    expect(shotFor('Narrative')).toBe('a medium-wide shot');
  });

  it('falls back to a cinematic wide shot for null, unknown, or ambiguous', () => {
    expect(shotFor(null)).toBe('a cinematic wide shot');
    expect(shotFor('')).toBe('a cinematic wide shot');
    expect(shotFor('ambiguous')).toBe('a cinematic wide shot');
    expect(shotFor('something-else')).toBe('a cinematic wide shot');
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
  sceneType: 'dialogue',
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
      sceneType: null,
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

  it('leads with the action/key moment before the shot/camera phrase (director order)', () => {
    const { prompt } = buildScenePrompt({
      scene: fullScene,
      characters: [evie],
      style: painterly,
    });
    const momentAt = prompt.indexOf('Evie slams the ledger');
    const shotAt = prompt.indexOf(framingFor(fullScene.sceneType, { characterCount: 1 }));
    expect(momentAt).toBeGreaterThanOrEqual(0);
    expect(shotAt).toBeGreaterThan(momentAt);
  });

  it('positions the shot/camera phrase just before the style fragment', () => {
    const { prompt } = buildScenePrompt({
      scene: fullScene,
      characters: [evie],
      style: painterly,
    });
    const shotAt = prompt.indexOf(framingFor(fullScene.sceneType, { characterCount: 1 }));
    const styleAt = prompt.indexOf(painterly.promptFragment);
    expect(shotAt).toBeGreaterThanOrEqual(0);
    expect(styleAt).toBeGreaterThan(shotAt);
  });

  it('orders subject/action before setting before lighting before mood before shot before style', () => {
    const { prompt } = buildScenePrompt({
      scene: fullScene,
      characters: [evie],
      style: painterly,
    });
    const momentAt = prompt.indexOf('Evie slams the ledger');
    const castAt = prompt.indexOf('Featuring');
    const settingAt = prompt.indexOf('candlelit study');
    const lightingAt = prompt.indexOf('warm golden-hour light');
    const moodAt = prompt.toLowerCase().indexOf('tense');
    const shotAt = prompt.indexOf(framingFor('dialogue', { characterCount: 1 }));
    const styleAt = prompt.indexOf(painterly.promptFragment);
    expect(momentAt).toBeGreaterThanOrEqual(0);
    expect(castAt).toBeGreaterThan(momentAt);
    expect(settingAt).toBeGreaterThan(castAt);
    expect(lightingAt).toBeGreaterThan(settingAt);
    expect(moodAt).toBeGreaterThan(lightingAt);
    expect(shotAt).toBeGreaterThan(moodAt);
    expect(styleAt).toBeGreaterThan(shotAt);
  });

  it('derives the shot from sceneType + count: a two-character dialogue scene uses a waist-up two-shot', () => {
    const { prompt } = buildScenePrompt({
      scene: { ...fullScene, sceneType: 'dialogue' },
      characters: [evie, tom],
      style: painterly,
    });
    expect(prompt).toContain('a waist-up two-shot');
  });

  it('derives the shot from sceneType: an action scene uses a dynamic low-angle wide shot', () => {
    const { prompt } = buildScenePrompt({
      scene: { ...fullScene, sceneType: 'action' },
      characters: [evie],
      style: painterly,
    });
    expect(prompt).toContain('a dynamic wide shot from a low angle');
  });

  it('derives the shot from sceneType: a description scene uses a wide establishing shot', () => {
    const { prompt } = buildScenePrompt({
      scene: { ...fullScene, sceneType: 'description' },
      characters: [],
      style: painterly,
    });
    expect(prompt).toContain('a wide establishing shot');
  });

  it('falls back to a cinematic wide shot when sceneType is null', () => {
    const { prompt } = buildScenePrompt({
      scene: { ...fullScene, sceneType: null },
      characters: [],
      style: painterly,
    });
    expect(prompt).toContain('a cinematic wide shot');
  });
});

describe('framingFor', () => {
  // action keeps the dynamic low-angle wide regardless of how many are in frame.
  it('keeps the dynamic low-angle wide for action at any character count', () => {
    for (const count of [0, 1, 2, 3, 5]) {
      expect(framingFor('action', { characterCount: count })).toBe(
        'a dynamic wide shot from a low angle',
      );
    }
  });

  // description/transition stay wide establishing (scene-setting; faces not the point).
  it('keeps a wide establishing shot for description/transition at any count', () => {
    for (const type of ['description', 'transition']) {
      for (const count of [0, 1, 2, 3]) {
        expect(framingFor(type, { characterCount: count })).toBe('a wide establishing shot');
      }
    }
  });

  // dialogue/narrative/unknown with 1 character → tighter waist-up medium so the
  // single face renders large.
  it('tightens to a waist-up medium for a single character in dialogue/narrative/unknown', () => {
    expect(framingFor('dialogue', { characterCount: 1 })).toBe('a medium shot, waist-up');
    expect(framingFor('narrative', { characterCount: 1 })).toBe('a medium shot, waist-up');
    expect(framingFor('mystery', { characterCount: 1 })).toBe('a medium shot, waist-up');
    expect(framingFor(null, { characterCount: 1 })).toBe('a medium shot, waist-up');
  });

  // dialogue/narrative/unknown with 2 characters → a medium close-up two-shot.
  it('uses a waist-up two-shot for two characters in dialogue/narrative/unknown', () => {
    expect(framingFor('dialogue', { characterCount: 2 })).toBe('a waist-up two-shot');
    expect(framingFor('narrative', { characterCount: 2 })).toBe('a waist-up two-shot');
    expect(framingFor('mystery', { characterCount: 2 })).toBe('a waist-up two-shot');
    expect(framingFor(null, { characterCount: 2 })).toBe('a waist-up two-shot');
  });

  // importance >= 4 pulls slightly tighter still for the 1–2 band.
  it('pulls tighter to a medium close-up for high-importance 1–2 character beats', () => {
    expect(framingFor('dialogue', { characterCount: 1, importance: 4 })).toBe(
      'a medium close-up',
    );
    expect(framingFor('dialogue', { characterCount: 2, importance: 5 })).toBe(
      'a medium close-up two-shot',
    );
    expect(framingFor('narrative', { characterCount: 1, importance: 4 })).toBe(
      'a medium close-up',
    );
  });

  it('does not pull tighter below the importance threshold', () => {
    expect(framingFor('dialogue', { characterCount: 1, importance: 3 })).toBe(
      'a medium shot, waist-up',
    );
    expect(framingFor('dialogue', { characterCount: 2, importance: 3 })).toBe('a waist-up two-shot');
  });

  // The boundary: 2 stays tight, 3+ widens to a group shot (accept smaller faces).
  it('widens to a wide group shot at 3+ characters (boundary at 2 vs 3)', () => {
    expect(framingFor('dialogue', { characterCount: 2 })).toBe('a waist-up two-shot');
    expect(framingFor('dialogue', { characterCount: 3 })).toBe('a wide group shot');
    expect(framingFor('narrative', { characterCount: 4 })).toBe('a wide group shot');
    // importance does not override the group-widen decision.
    expect(framingFor('dialogue', { characterCount: 3, importance: 5 })).toBe('a wide group shot');
  });

  // With zero characters there is nobody to frame tight; fall back to shotFor.
  it('falls back to shotFor when there are no characters in frame', () => {
    expect(framingFor('dialogue', { characterCount: 0 })).toBe(shotFor('dialogue'));
    expect(framingFor('narrative', { characterCount: 0 })).toBe(shotFor('narrative'));
    expect(framingFor(null, { characterCount: 0 })).toBe(shotFor(null));
  });

  it('is case- and whitespace-insensitive on the sceneType', () => {
    expect(framingFor('  Dialogue ', { characterCount: 1 })).toBe('a medium shot, waist-up');
    expect(framingFor('ACTION', { characterCount: 2 })).toBe(
      'a dynamic wide shot from a low angle',
    );
  });
});

describe('shotFor back-compat (1-arg form unchanged)', () => {
  // framingFor must not perturb the legacy shotFor contract: the 1-arg form
  // still returns exactly what it did before count/importance awareness existed.
  it('returns byte-identical values for the 1-arg form', () => {
    expect(shotFor('dialogue')).toBe('a medium two-shot');
    expect(shotFor('action')).toBe('a dynamic wide shot from a low angle');
    expect(shotFor('description')).toBe('a wide establishing shot');
    expect(shotFor('transition')).toBe('a wide establishing shot');
    expect(shotFor('narrative')).toBe('a medium-wide shot');
    expect(shotFor(null)).toBe('a cinematic wide shot');
    expect(shotFor('ambiguous')).toBe('a cinematic wide shot');
  });
});

describe('buildScenePrompt framing by character count', () => {
  it('frames a single-character dialogue beat as a waist-up medium (bigger face)', () => {
    const { prompt } = buildScenePrompt({
      scene: { ...fullScene, sceneType: 'dialogue' },
      characters: [evie],
      style: painterly,
    });
    expect(prompt).toContain('a medium shot, waist-up');
    expect(prompt).not.toContain('a medium two-shot');
  });

  it('frames a two-character dialogue beat as a waist-up two-shot', () => {
    const { prompt } = buildScenePrompt({
      scene: { ...fullScene, sceneType: 'dialogue' },
      characters: [evie, tom],
      style: painterly,
    });
    expect(prompt).toContain('a waist-up two-shot');
  });

  it('widens a three-character dialogue beat to a wide group shot', () => {
    const mara: CharacterForPrompt = { name: 'Mara', appearanceToken: null, profile: null };
    const { prompt } = buildScenePrompt({
      scene: { ...fullScene, sceneType: 'dialogue' },
      characters: [evie, tom, mara],
      style: painterly,
    });
    expect(prompt).toContain('a wide group shot');
  });

  it('keeps action wide/low-angle even with a single character', () => {
    const { prompt } = buildScenePrompt({
      scene: { ...fullScene, sceneType: 'action' },
      characters: [evie],
      style: painterly,
    });
    expect(prompt).toContain('a dynamic wide shot from a low angle');
  });

  it('keeps description as a wide establishing shot even with two characters', () => {
    const { prompt } = buildScenePrompt({
      scene: { ...fullScene, sceneType: 'description' },
      characters: [evie, tom],
      style: painterly,
    });
    expect(prompt).toContain('a wide establishing shot');
  });

  it('pulls a high-importance single-character beat tighter to a medium close-up', () => {
    const { prompt } = buildScenePrompt({
      scene: { ...fullScene, sceneType: 'dialogue' },
      characters: [evie],
      style: painterly,
      importance: 5,
    });
    expect(prompt).toContain('a medium close-up');
  });

  it('uses shotFor framing when there are no characters in frame', () => {
    const { prompt } = buildScenePrompt({
      scene: { ...fullScene, sceneType: 'dialogue' },
      characters: [],
      style: painterly,
    });
    expect(prompt).toContain(shotFor('dialogue'));
  });
});

describe('buildScenePrompt position hints for 2+ characters', () => {
  const mara: CharacterForPrompt = {
    name: 'Mara',
    appearanceToken: null,
    profile: profile({ age: 'old woman', hair: 'silver' }),
  };

  it('weaves left/right position phrases for two characters in array order', () => {
    const { prompt } = buildScenePrompt({
      scene: fullScene,
      characters: [evie, tom],
      style: painterly,
    });
    const evieAt = prompt.indexOf('Evie');
    const tomAt = prompt.indexOf('Tom');
    const leftAt = prompt.indexOf('on the left');
    const rightAt = prompt.indexOf('on the right');
    expect(leftAt).toBeGreaterThan(evieAt);
    expect(leftAt).toBeLessThan(tomAt);
    expect(rightAt).toBeGreaterThan(tomAt);
  });

  it('weaves left/center/right for three characters in array order', () => {
    const { prompt } = buildScenePrompt({
      scene: fullScene,
      characters: [evie, tom, mara],
      style: painterly,
    });
    const leftAt = prompt.indexOf('on the left');
    const centerAt = prompt.indexOf('in the center');
    const rightAt = prompt.indexOf('on the right');
    expect(leftAt).toBeGreaterThanOrEqual(0);
    expect(centerAt).toBeGreaterThan(leftAt);
    expect(rightAt).toBeGreaterThan(centerAt);
  });

  it('adds no position phrase for a single character', () => {
    const { prompt } = buildScenePrompt({
      scene: fullScene,
      characters: [evie],
      style: painterly,
    });
    expect(prompt).not.toContain('on the left');
    expect(prompt).not.toContain('on the right');
    expect(prompt).not.toContain('in the center');
  });

  it('still preserves each appearance token substance verbatim with position hints', () => {
    const { prompt } = buildScenePrompt({
      scene: fullScene,
      characters: [evie, tom],
      style: painterly,
    });
    expect(prompt).toContain(
      'young woman, slender build, lavender hair, hazel eyes, wearing a practical work dress, ink-stained fingers',
    );
    expect(prompt).toContain(
      'weathered man, broad-shouldered build, cropped grey hair, grey eyes, wearing a travel-worn cloak, grey beard',
    );
  });

  it('keeps the LoRA keyword adjacent to the right character alongside its position', () => {
    const { prompt } = buildScenePrompt({
      scene: fullScene,
      characters: [{ ...evie, loraKeyword: 'kariiina' }, tom],
      style: painterly,
    });
    // The keyword still leads Evie's clause; Tom never picks it up.
    expect(prompt).toContain('kariiina Evie');
    expect(prompt).not.toContain('kariiina Tom');
    // Evie is on the left, Tom on the right (array order).
    const evieAt = prompt.indexOf('kariiina Evie');
    const leftAt = prompt.indexOf('on the left');
    const tomAt = prompt.indexOf('Tom');
    expect(leftAt).toBeGreaterThan(evieAt);
    expect(leftAt).toBeLessThan(tomAt);
  });
});

describe('LoRA keyword weaving (imaging)', () => {
  // Baselines: the exact current output with NO keyword. Off-path output must
  // be byte-identical to these (the keyword feature must not perturb anything
  // when absent), asserted with .toEqual the way the mature-content tests do.
  const portraitBaseline = buildPortraitPrompt({ character: evie, style: painterly });
  const sceneBaseline = buildScenePrompt({
    scene: fullScene,
    characters: [evie, tom],
    style: painterly,
  });

  describe('buildPortraitPrompt', () => {
    it('weaves a non-empty loraKeyword leading the subject phrase', () => {
      const { prompt } = buildPortraitPrompt({
        character: { ...evie, loraKeyword: 'kariiina' },
        style: painterly,
      });
      // Keyword leads the subject: "{keyword}, {name}, {appearance}…".
      expect(prompt).toContain(
        'character portrait of kariiina, Evie, young woman, slender build, lavender hair, hazel eyes, wearing a practical work dress, ink-stained fingers',
      );
      looksLikeProse(prompt);
    });

    it('weaves the keyword for a name-only character as "{keyword}, {name}"', () => {
      const { prompt } = buildPortraitPrompt({
        character: { name: 'Quill', appearanceToken: null, profile: null, loraKeyword: 'qtoken' },
        style: painterly,
      });
      expect(prompt).toContain('character portrait of qtoken, Quill');
      looksLikeProse(prompt);
    });

    it('is byte-identical to the baseline when loraKeyword is absent', () => {
      expect(buildPortraitPrompt({ character: evie, style: painterly })).toEqual(portraitBaseline);
    });

    it('is byte-identical to the baseline when loraKeyword is null', () => {
      expect(
        buildPortraitPrompt({ character: { ...evie, loraKeyword: null }, style: painterly }),
      ).toEqual(portraitBaseline);
    });

    it('is byte-identical to the baseline when loraKeyword is blank/whitespace', () => {
      expect(
        buildPortraitPrompt({ character: { ...evie, loraKeyword: '   ' }, style: painterly }),
      ).toEqual(portraitBaseline);
    });

    it('is deterministic with a keyword woven in', () => {
      const a = buildPortraitPrompt({
        character: { ...evie, loraKeyword: 'kariiina' },
        style: { ...painterly },
      });
      const b = buildPortraitPrompt({
        character: { ...evie, loraKeyword: 'kariiina' },
        style: { ...painterly },
      });
      expect(a).toEqual(b);
    });
  });

  describe('buildScenePrompt', () => {
    it("weaves the keyword into THAT character's clause as '{keyword} {name} ({appearance})'", () => {
      const { prompt } = buildScenePrompt({
        scene: fullScene,
        characters: [{ ...evie, loraKeyword: 'kariiina' }],
        style: painterly,
      });
      expect(prompt).toContain(
        'kariiina Evie (young woman, slender build, lavender hair, hazel eyes, wearing a practical work dress, ink-stained fingers)',
      );
      looksLikeProse(prompt);
    });

    it('binds each keyword to its own character and leaves un-keyworded ones unchanged', () => {
      const { prompt } = buildScenePrompt({
        scene: fullScene,
        characters: [{ ...evie, loraKeyword: 'kariiina' }, tom],
        style: painterly,
      });
      // Evie gets her keyword bound to her clause (with her left-position hint at
      // 2 characters; the appearance substance is still verbatim).
      expect(prompt).toContain(
        'kariiina Evie (young woman, slender build, lavender hair, hazel eyes, wearing a practical work dress, ink-stained fingers, on the left)',
      );
      // Tom (no keyword) is unchanged — no keyword leaks onto him; right position.
      expect(prompt).toContain(
        'Tom (weathered man, broad-shouldered build, cropped grey hair, grey eyes, wearing a travel-worn cloak, grey beard, on the right)',
      );
      expect(prompt).not.toContain('kariiina Tom');
    });

    it('keeps "{keyword} {name}" attached when the description is dropped under length pressure', () => {
      const wordy = (n: number, p: string) =>
        Array.from({ length: n }, (_, i) => `${p}${i}`).join(' ');
      const scene: SceneForPrompt = {
        ...fullScene,
        keyVisualMoment: wordy(150, 'moment'),
        setting: wordy(40, 'place'),
      };
      const characters: CharacterForPrompt[] = [
        { name: 'Evie', appearanceToken: `Evie: ${wordy(20, 'evie')}`, profile: null, loraKeyword: 'kariiina' },
        { name: 'Tom', appearanceToken: `Tom: ${wordy(20, 'tom')}`, profile: null },
      ];
      const { prompt } = buildScenePrompt({ scene, characters, style: painterly });
      // Description dropped, but the keyword stays attached to its name (not orphaned).
      expect(prompt).not.toContain('evie0');
      expect(prompt).toContain('kariiina Evie');
      expect(prompt).toContain('Tom');
      expect(prompt).not.toContain('kariiina Tom');
    });

    it('is byte-identical to the baseline when no character has a loraKeyword', () => {
      expect(
        buildScenePrompt({ scene: fullScene, characters: [evie, tom], style: painterly }),
      ).toEqual(sceneBaseline);
    });

    it('is byte-identical to the baseline when loraKeyword is null/blank', () => {
      expect(
        buildScenePrompt({
          scene: fullScene,
          characters: [
            { ...evie, loraKeyword: null },
            { ...tom, loraKeyword: '   ' },
          ],
          style: painterly,
        }),
      ).toEqual(sceneBaseline);
    });

    it('is deterministic with keywords woven in', () => {
      const make = () =>
        buildScenePrompt({
          scene: { ...fullScene },
          characters: [{ ...evie, loraKeyword: 'kariiina' }, { ...tom }],
          style: { ...painterly },
        });
      expect(make()).toEqual(make());
    });
  });
});

describe('mature-content fidelity (imaging)', () => {
  const portraitOff = buildPortraitPrompt({ character: evie, style: painterly });
  const sceneOff = buildScenePrompt({ scene: fullScene, characters: [evie], style: painterly });

  it('the fidelity instruction asks for a faithful depiction matching source intensity', () => {
    expect(IMAGING_FIDELITY_INSTRUCTION).toMatch(/faithful/i);
    expect(IMAGING_FIDELITY_INSTRUCTION).toMatch(/intensity/i);
  });

  describe('buildPortraitPrompt', () => {
    it('produces byte-identical output to current when mature is absent', () => {
      expect(buildPortraitPrompt({ character: evie, style: painterly })).toEqual(portraitOff);
    });

    it('produces byte-identical output to the absent case when mature is false', () => {
      expect(buildPortraitPrompt({ character: evie, style: painterly, mature: false })).toEqual(
        portraitOff,
      );
    });

    it('does not include the fidelity instruction when mature is off', () => {
      expect(portraitOff.prompt).not.toContain(IMAGING_FIDELITY_INSTRUCTION);
    });

    it('includes the fidelity instruction when mature is on', () => {
      const { prompt } = buildPortraitPrompt({ character: evie, style: painterly, mature: true });
      expect(prompt).toContain(IMAGING_FIDELITY_INSTRUCTION);
    });

    it('still ends with the technical clause on the mature path', () => {
      const { prompt, negative } = buildPortraitPrompt({
        character: evie,
        style: painterly,
        mature: true,
      });
      looksLikeProse(prompt); // also asserts the trailing technical clause
      expect(negative).toBe('');
    });

    it('is deterministic on the mature path', () => {
      const a = buildPortraitPrompt({ character: { ...evie }, style: { ...painterly }, mature: true });
      const b = buildPortraitPrompt({ character: { ...evie }, style: { ...painterly }, mature: true });
      expect(a).toEqual(b);
    });
  });

  describe('buildScenePrompt', () => {
    it('produces byte-identical output to current when mature is absent', () => {
      expect(buildScenePrompt({ scene: fullScene, characters: [evie], style: painterly })).toEqual(
        sceneOff,
      );
    });

    it('produces byte-identical output to the absent case when mature is false', () => {
      expect(
        buildScenePrompt({ scene: fullScene, characters: [evie], style: painterly, mature: false }),
      ).toEqual(sceneOff);
    });

    it('does not include the fidelity instruction when mature is off', () => {
      expect(sceneOff.prompt).not.toContain(IMAGING_FIDELITY_INSTRUCTION);
    });

    it('includes the fidelity instruction when mature is on', () => {
      const { prompt } = buildScenePrompt({
        scene: fullScene,
        characters: [evie],
        style: painterly,
        mature: true,
      });
      expect(prompt).toContain(IMAGING_FIDELITY_INSTRUCTION);
    });

    it('still ends with the technical clause on the mature path', () => {
      const { prompt, negative } = buildScenePrompt({
        scene: fullScene,
        characters: [evie],
        style: painterly,
        mature: true,
      });
      looksLikeProse(prompt); // also asserts the trailing technical clause
      expect(negative).toBe('');
    });

    it('keeps the key visual moment and style on the mature path', () => {
      const { prompt } = buildScenePrompt({
        scene: fullScene,
        characters: [evie],
        style: painterly,
        mature: true,
      });
      expect(prompt).toContain('Evie slams the ledger onto the desk as candle flames gutter');
      expect(prompt).toContain(painterly.promptFragment);
    });

    it('is deterministic on the mature path', () => {
      const a = buildScenePrompt({ scene: { ...fullScene }, characters: [{ ...evie }], style: { ...painterly }, mature: true });
      const b = buildScenePrompt({ scene: { ...fullScene }, characters: [{ ...evie }], style: { ...painterly }, mature: true });
      expect(a).toEqual(b);
    });
  });
});

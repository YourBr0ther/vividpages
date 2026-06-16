/**
 * Image prompt assembly: deterministic, LLM-free composition of portrait and
 * scene prompts from character profiles, scene metadata, and a style preset.
 *
 * Tuned for Z-Image Turbo (a CFG≈1 distilled model). Two consequences shape
 * everything here:
 *
 *  1. Negative prompts are inert at CFG≈1, so both builders return an EMPTY
 *     negative. Technical constraints ("no text/watermark/logo") are folded
 *     into a short trailing clause of the POSITIVE prompt instead.
 *  2. The model follows long, precise natural-language *prose* far better than
 *     comma-separated tag soup, and is very responsive to explicit lighting
 *     language. So the builders emit camera-structured sentences on the
 *     scaffold: [shot/composition] + [subject] + [clothing] + [environment]
 *     + [lighting] + [mood] + [style/medium] + [technical constraints].
 *
 * Pure (no IO) and deterministic: identical input → byte-identical output.
 */

import type { CharacterProfile } from '../analysis/profile-schema';

export interface StyleFragment {
  promptFragment: string;
  negativeFragment: string;
}

export interface CharacterForPrompt {
  name: string;
  appearanceToken: string | null;
  profile: CharacterProfile | null;
}

export interface SceneForPrompt {
  summary: string | null;
  setting: string | null;
  timeOfDay: string | null;
  mood: string | null;
  keyVisualMoment: string | null;
}

/** Most characters described in one scene prompt. */
export const MAX_SCENE_CHARACTERS = 3;

/** Word cap for each character description inside a scene prompt. */
export const MAX_SCENE_DESCRIPTION_WORDS = 25;

/**
 * Soft word cap for the whole scene prompt. The scaffold guidance is 80–250
 * words ("long and precise"); we aim under this and shed detail (character
 * descriptions first, then the setting — never the key moment) when over.
 */
export const MAX_SCENE_PROMPT_WORDS = 230;

/** Action used when a scene has no key moment or summary. */
const SCENE_FALLBACK = 'A quiet narrative moment';

/**
 * Trailing technical-constraint clause. On a CFG≈1 model these belong in the
 * positive prompt (the negative is ignored), phrased as plain prose.
 */
const TECHNICAL_CLAUSE = 'No text, watermarks, or logos.';

const countWords = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/** Trims, collapses whitespace, and strips trailing punctuation. */
function normalizeFragment(value: string): string {
  return value.trim().replace(/\s+/g, ' ').replace(/[.,;\s]+$/, '');
}

/** Ensures a fragment reads as one sentence ending in exactly one period. */
function sentence(fragment: string): string {
  return `${normalizeFragment(fragment)}.`;
}

/** Truncates to a word budget at a word boundary, never mid-word. */
function capWords(text: string, max: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= max) return text;
  return normalizeFragment(words.slice(0, max).join(' '));
}

/**
 * Maps our `timeOfDay` enum to an explicit lighting phrase. Z-Image Turbo is
 * very responsive to lighting language, so we always state it. Case- and
 * whitespace-insensitive; null/unknown values fall back to neutral lighting.
 */
export function lightingFor(timeOfDay: string | null): string {
  const key = (timeOfDay ?? '').trim().toLowerCase();
  switch (key) {
    case 'dawn':
      return 'pale, cool dawn light';
    case 'morning':
      return 'soft morning light';
    case 'midday':
    case 'noon':
      return 'bright midday sunlight';
    case 'afternoon':
      return 'bright afternoon daylight';
    case 'evening':
      return 'warm golden-hour light';
    case 'dusk':
    case 'twilight':
      return 'fading violet dusk light';
    case 'night':
      return 'dim, low-key moonlit night lighting';
    default:
      return 'natural, even lighting';
  }
}

/**
 * Appends a label noun ('hair', 'eyes', …) when the value doesn't already
 * name it, so single-word traits like 'dark' or 'lavender' read unambiguously
 * ('dark hair', 'lavender hair') regardless of position in the prompt.
 */
function labeled(value: string, label: string): string {
  const words = value.toLowerCase().split(/\s+/);
  return words.includes(label) ? value : `${value} ${label}`;
}

const ARTICLES = new Set(['a', 'an', 'the', 'his', 'her', 'their', 'its', 'some']);

/** Phrases attire as 'wearing a …', adding the article only when needed. */
function attirePhrase(value: string): string {
  const words = value.split(/\s+/);
  if (words[0]?.toLowerCase() === 'wearing') return value;
  if (ARTICLES.has(words[0]?.toLowerCase() ?? '')) return `wearing ${value}`;
  const last = words[words.length - 1] ?? '';
  // Plural-ish head noun ('robes', 'clothes') takes no article; 'dress' (-ss)
  // stays singular.
  const plural = /s$/i.test(last) && !/ss$/i.test(last);
  if (plural) return `wearing ${value}`;
  const article = /^[aeiou]/i.test(value) ? 'an' : 'a';
  return `wearing ${article} ${value}`;
}

/** Strips the leading 'Name: ' prefix from an appearance token. */
function tokenBody(token: string): string {
  const colon = token.indexOf(':');
  return normalizeFragment(colon >= 0 ? token.slice(colon + 1) : token);
}

/**
 * Renders one character's visual description as a comma list of labeled
 * traits ('young woman, slender build, lavender hair, hazel eyes, wearing a
 * practical work dress, ink-stained fingers'). Prefers profile fields; falls
 * back to the appearance token without its name prefix, then to the name
 * alone.
 *
 * The trait substance is the cross-image consistency mechanism (and the LoRA
 * anchor), so it is reproduced VERBATIM — woven into a sentence by the
 * builders, but never paraphrased or summarized away. Deterministic.
 */
export function renderCharacterDescription(c: CharacterForPrompt): string {
  const name = normalizeFragment(c.name);

  if (c.profile) {
    const p = c.profile;
    const parts: string[] = [];
    const push = (value: string | null, render: (v: string) => string = (v) => v) => {
      if (typeof value !== 'string') return;
      const fragment = normalizeFragment(value);
      if (fragment) parts.push(render(fragment));
    };
    push(p.age);
    push(p.build, (v) => labeled(v, 'build'));
    push(p.skin, (v) => labeled(v, 'skin'));
    push(p.hair, (v) => labeled(v, 'hair'));
    push(p.eyes, (v) => labeled(v, 'eyes'));
    push(p.attire, attirePhrase);
    push(p.distinguishing);
    if (parts.length > 0) return parts.join(', ');
  }

  if (c.appearanceToken) {
    const body = tokenBody(c.appearanceToken);
    if (body && body !== name) return body;
  }

  return name;
}

/**
 * Character portrait prompt as camera-structured prose. The appearance
 * description is embedded verbatim so every portrait of a character reuses the
 * same identity fragment (the consistency anchor). Studio framing and lighting
 * are fixed; the style preset supplies the medium/style. The negative is empty
 * (inert on Z-Image Turbo). Deterministic.
 *
 * Scaffold: [shot] of [subject: name + appearance/clothing]. [environment].
 * [lighting]. [style/medium]. [mood]. [technical constraints].
 */
export function buildPortraitPrompt(args: {
  character: CharacterForPrompt;
  style: StyleFragment;
}): { prompt: string; negative: string } {
  const name = normalizeFragment(args.character.name);
  const description = renderCharacterDescription(args.character);
  const subject =
    description === name
      ? `A three-quarter character portrait of ${name}`
      : `A three-quarter character portrait of ${name}, ${description}`;

  const prompt = [
    sentence(subject),
    'Set against a neutral studio backdrop with soft ambient depth.',
    'Lit with even, soft studio lighting.',
    sentence(`Rendered as ${normalizeFragment(args.style.promptFragment)}`),
    'A focused, dignified character study.',
    TECHNICAL_CLAUSE,
  ].join(' ');

  return { prompt, negative: '' };
}

interface SceneParts {
  composition: string;
  moment: string;
  characters: string | null;
  setting: string | null;
  lighting: string;
  mood: string | null;
  style: string;
  technical: string;
}

/**
 * Joins the scaffold in reading order:
 * [composition] [action] [cast] [setting] [lighting] [mood] [style] [technical].
 * Null slots are omitted. The technical clause always trails last.
 */
function joinSceneParts(parts: SceneParts): string {
  return [
    parts.composition,
    parts.moment,
    parts.characters,
    parts.setting,
    parts.lighting,
    parts.mood,
    parts.style,
    parts.technical,
  ]
    .filter((p): p is string => p !== null)
    .join(' ');
}

/**
 * Scene illustration prompt as camera-structured prose. Leads with a cinematic
 * composition and the key visual moment as the action (falling back to the
 * summary, then a generic beat), then the present cast (name + verbatim
 * appearance, capped at MAX_SCENE_CHARACTERS), the setting, explicit lighting
 * derived from `timeOfDay`, the mood, the style preset as medium, and the
 * trailing technical clause.
 *
 * Under length pressure it drops character descriptions first (keeping the
 * names), then the setting clause — never the key moment, lighting, or style.
 * The negative is empty (inert on Z-Image Turbo). Deterministic.
 */
export function buildScenePrompt(args: {
  scene: SceneForPrompt;
  characters: CharacterForPrompt[];
  style: StyleFragment;
}): { prompt: string; negative: string } {
  const { scene, style } = args;

  const moment = scene.keyVisualMoment?.trim() || scene.summary?.trim() || SCENE_FALLBACK;
  const setting = scene.setting?.trim()
    ? sentence(`The setting is ${normalizeFragment(scene.setting)}`)
    : null;

  const lighting = sentence(`Lit with ${lightingFor(scene.timeOfDay)}`);

  const mood = scene.mood?.trim()
    ? sentence(`The mood is ${normalizeFragment(scene.mood)}`)
    : null;

  const cast = args.characters.slice(0, MAX_SCENE_CHARACTERS).map((c) => ({
    name: normalizeFragment(c.name),
    description: capWords(renderCharacterDescription(c), MAX_SCENE_DESCRIPTION_WORDS),
  }));

  const castClause = (withDescriptions: boolean): string | null => {
    if (cast.length === 0) return null;
    const rendered = cast.map((c) =>
      withDescriptions && c.description && c.description !== c.name
        ? `${c.name} (${c.description})`
        : c.name,
    );
    const list =
      rendered.length === 1
        ? rendered[0]
        : `${rendered.slice(0, -1).join(', ')} and ${rendered[rendered.length - 1]}`;
    return sentence(`Featuring ${list}`);
  };

  const base: SceneParts = {
    composition: 'A cinematic, illustrative wide shot.',
    moment: sentence(moment),
    characters: castClause(true),
    setting,
    lighting,
    mood,
    style: sentence(`Rendered as ${normalizeFragment(style.promptFragment)}`),
    technical: TECHNICAL_CLAUSE,
  };

  // Drop order under length pressure: character descriptions (keep names),
  // then the setting clause. The key moment, lighting, mood, and style survive.
  const variants: SceneParts[] = [
    base,
    { ...base, characters: castClause(false) },
    { ...base, characters: castClause(false), setting: null },
  ];

  let prompt = joinSceneParts(variants[variants.length - 1]!);
  for (const variant of variants) {
    const candidate = joinSceneParts(variant);
    if (countWords(candidate) <= MAX_SCENE_PROMPT_WORDS) {
      prompt = candidate;
      break;
    }
  }

  return { prompt, negative: '' };
}

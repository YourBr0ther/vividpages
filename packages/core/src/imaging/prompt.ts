/**
 * Image prompt assembly: deterministic, LLM-free composition of portrait and
 * scene prompts from character profiles, scene metadata, and a style preset.
 * Z-Image Turbo follows concise natural prose better than tag soup, so the
 * builders emit short sentences rather than keyword lists. Pure (no IO).
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

/** Negative terms appended to every prompt regardless of style. */
export const NEGATIVE_BASE =
  'deformed, extra fingers, extra limbs, lowres, blurry, jpeg artifacts, text, watermark';

/** Most characters listed in one scene prompt. */
export const MAX_SCENE_CHARACTERS = 3;

/** Word cap for each character description inside a scene prompt. */
export const MAX_SCENE_DESCRIPTION_WORDS = 25;

/** Soft word cap for the whole scene prompt. */
export const MAX_SCENE_PROMPT_WORDS = 180;

const SCENE_FALLBACK = 'A quiet narrative moment.';

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
 * alone. Deterministic.
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

/** Splits a comma-separated negative fragment into normalized terms. */
function negativeTerms(fragment: string): string[] {
  return fragment
    .split(',')
    .map((term) => normalizeFragment(term).toLowerCase())
    .filter(Boolean);
}

/** Style negative first, shared base appended, duplicates removed. */
function buildNegative(style: StyleFragment): string {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of [...negativeTerms(style.negativeFragment), ...negativeTerms(NEGATIVE_BASE)]) {
    if (seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return terms.join(', ');
}

/**
 * Character portrait prompt: style, identity, then neutral framing. The
 * description is embedded verbatim so every portrait of a character reuses
 * the same identity fragment.
 */
export function buildPortraitPrompt(args: {
  character: CharacterForPrompt;
  style: StyleFragment;
}): { prompt: string; negative: string } {
  const name = normalizeFragment(args.character.name);
  const description = renderCharacterDescription(args.character);
  const identity =
    description === name
      ? `Character portrait of ${name}`
      : `Character portrait of ${name}: ${description}`;
  const prompt = [
    sentence(args.style.promptFragment),
    sentence(identity),
    'Three-quarter view, neutral background with soft ambient depth, focused character study.',
  ].join(' ');
  return { prompt, negative: buildNegative(args.style) };
}

interface SceneParts {
  style: string;
  moment: string;
  setting: string | null;
  light: string | null;
  characters: string | null;
}

function joinSceneParts(parts: SceneParts): string {
  return [parts.style, parts.moment, parts.setting, parts.light, parts.characters]
    .filter((p): p is string => p !== null)
    .join(' ');
}

/**
 * Scene illustration prompt. Leads with the key visual moment (falling back
 * to the summary, then a generic beat), then setting, light/mood, and up to
 * three characters in caller order with word-capped verbatim descriptions.
 * Under length pressure it drops character descriptions first (keeping the
 * names), then the setting line — never the key moment. Deterministic.
 */
export function buildScenePrompt(args: {
  scene: SceneForPrompt;
  characters: CharacterForPrompt[];
  style: StyleFragment;
}): { prompt: string; negative: string } {
  const { scene, style } = args;

  const moment = scene.keyVisualMoment?.trim() || scene.summary?.trim() || SCENE_FALLBACK;
  const setting = scene.setting?.trim() ? sentence(`Setting: ${scene.setting}`) : null;

  const timeOfDay = scene.timeOfDay?.trim();
  const mood = scene.mood?.trim();
  const light =
    timeOfDay && mood
      ? sentence(`${timeOfDay} light, ${mood} mood`)
      : timeOfDay
        ? sentence(`${timeOfDay} light`)
        : mood
          ? sentence(`${mood} mood`)
          : null;

  const cast = args.characters.slice(0, MAX_SCENE_CHARACTERS).map((c) => ({
    name: normalizeFragment(c.name),
    description: capWords(renderCharacterDescription(c), MAX_SCENE_DESCRIPTION_WORDS),
  }));

  const charactersFull =
    cast.length > 0
      ? sentence(
          `Characters present: ${cast
            .map((c) =>
              c.description && c.description !== c.name ? `${c.name} (${c.description})` : c.name,
            )
            .join('; ')}`,
        )
      : null;
  const charactersNamesOnly =
    cast.length > 0 ? sentence(`Characters present: ${cast.map((c) => c.name).join('; ')}`) : null;

  const base: SceneParts = {
    style: sentence(style.promptFragment),
    moment: sentence(moment),
    setting,
    light,
    characters: charactersFull,
  };

  // Drop order under length pressure: character descriptions, then the
  // setting line. The key moment (and style/light) always survive.
  const variants: SceneParts[] = [
    base,
    { ...base, characters: charactersNamesOnly },
    { ...base, characters: charactersNamesOnly, setting: null },
  ];

  let prompt = joinSceneParts(variants[variants.length - 1]!);
  for (const variant of variants) {
    const candidate = joinSceneParts(variant);
    if (countWords(candidate) <= MAX_SCENE_PROMPT_WORDS) {
      prompt = candidate;
      break;
    }
  }

  return { prompt, negative: buildNegative(style) };
}

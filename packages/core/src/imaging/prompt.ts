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
  /**
   * Optional LoRA trigger keyword (issue #2). When non-empty it is woven into
   * THIS character's subject phrase so the trigger binds to the right subject
   * in multi-character scenes (Z-Image guidance: trigger near the subject).
   * Null/absent/blank → output is byte-identical to the no-keyword path.
   */
  loraKeyword?: string | null;
  /**
   * Optional immutable body-model descriptor (wardrobe Phase 2): the
   * clothing-stripped physical identity reused verbatim across every
   * generation of this character (`characters.bodyModel`). Composed with
   * `outfit` into "{bodyModel}, wearing {outfit}" — but ONLY when BOTH are
   * present. Absent/null/blank → the existing profile/appearanceToken path
   * runs byte-identically (books predating the feature are unaffected).
   */
  bodyModel?: string | null;
  /**
   * Optional scene-resolved outfit descriptor (wardrobe Phase 2): the clothing
   * the scene's assigned appearance state puts on the body model
   * (`character_appearance_states.descriptor`). Woven verbatim after the body
   * model. Absent/null/blank (or with no `bodyModel`) → fallback path,
   * byte-identical to before.
   */
  outfit?: string | null;
}

/** The character's trigger keyword, trimmed; '' when null/absent/blank. */
function keywordOf(c: CharacterForPrompt): string {
  return (c.loraKeyword ?? '').trim();
}

export interface SceneForPrompt {
  summary: string | null;
  setting: string | null;
  timeOfDay: string | null;
  mood: string | null;
  /**
   * Analyzed scene type (narrative|dialogue|action|description|transition), or
   * null when unknown. Drives the camera shot via `shotFor`.
   */
  sceneType: string | null;
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

/**
 * Fidelity instruction folded into the positive prompt (just before the
 * trailing technical clause) when `mature` is on, for both portrait and scene
 * builders. Professional, non-graphic: it asks the model to be faithful, and
 * contains no explicit material itself. The technical clause still trails last.
 */
export const IMAGING_FIDELITY_INSTRUCTION =
  "Depict the moment faithfully and accurately, matching the source's intensity.";

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
 * Maps the analyzed `sceneType` to a camera shot phrase, so the framing varies
 * with content instead of being hardcoded "cinematic wide shot" for every
 * scene (Z-Image responds to explicit shot vocabulary). Case- and
 * whitespace-insensitive; null/unknown/'ambiguous' fall back to a neutral
 * cinematic wide shot.
 */
export function shotFor(sceneType: string | null): string {
  const key = (sceneType ?? '').trim().toLowerCase();
  switch (key) {
    case 'dialogue':
      return 'a medium two-shot';
    case 'action':
      return 'a dynamic wide shot from a low angle';
    case 'description':
    case 'transition':
      return 'a wide establishing shot';
    case 'narrative':
      return 'a medium-wide shot';
    default:
      return 'a cinematic wide shot';
  }
}

/** Importance at/above which a 1–2 character beat is pulled tighter still. */
const TIGHT_FRAMING_IMPORTANCE = 4;

/**
 * Picks the camera framing factoring **how many characters are in frame** (and
 * **importance** when known), so emotional 1–2 character beats are framed
 * tight enough that faces render large, while groups widen to fit everyone.
 *
 * A NEW function rather than overloading `shotFor`: `shotFor` keeps its simple,
 * exported, byte-identical 1-arg contract (and its tests), and the count/
 * importance logic — which only `buildScenePrompt` needs — lives in its own
 * clearly-named place instead of being bolted onto the back-compat surface.
 *
 *  - `action` → keep the dynamic low-angle wide regardless of count (motion
 *    reads better wide).
 *  - `description`/`transition` → keep the wide establishing shot (scene-setting;
 *    faces are not the point).
 *  - `dialogue`/`narrative`/unknown:
 *      - 0 characters → no one to frame tight; fall back to `shotFor`.
 *      - 1–2 characters → tight (waist-up); importance ≥ 4 pulls to a close-up.
 *      - 3+ characters → widen to a group shot (accept smaller faces).
 *
 * Pure and deterministic. Case- and whitespace-insensitive on `sceneType`.
 */
export function framingFor(
  sceneType: string | null,
  opts: { characterCount: number; importance?: number | null },
): string {
  const key = (sceneType ?? '').trim().toLowerCase();
  const count = opts.characterCount;
  const importance = opts.importance ?? null;

  if (key === 'action') return 'a dynamic wide shot from a low angle';
  if (key === 'description' || key === 'transition') return 'a wide establishing shot';

  // dialogue / narrative / unknown, framed by who is in shot.
  if (count <= 0) return shotFor(sceneType);
  if (count >= 3) return 'a wide group shot';

  const tight = importance !== null && importance >= TIGHT_FRAMING_IMPORTANCE;
  if (count === 1) return tight ? 'a medium close-up' : 'a medium shot, waist-up';
  // count === 2
  return tight ? 'a medium close-up two-shot' : 'a waist-up two-shot';
}

/**
 * Deterministic spatial position phrases woven into each character's clause
 * when 2+ characters share a scene, so the model separates them left-to-right
 * by their order in the cast array (an inexpensive grounding aid). A single
 * character gets no phrase (nothing to position against).
 */
const POSITION_HINTS: Record<number, string[]> = {
  2: ['on the left', 'on the right'],
  3: ['on the left', 'in the center', 'on the right'],
};

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
 *
 * Wardrobe Phase 2: when the character carries BOTH an immutable `bodyModel`
 * and a scene-resolved `outfit`, the description is composed as the body model
 * (verbatim, the immutable anchor) followed by the scene's clothing
 * ("{bodyModel}, wearing {outfit}"), bypassing the profile/token path. With
 * either field missing/blank it falls through to the existing behavior
 * byte-identically — books generated before the feature render exactly as
 * before.
 */
export function renderCharacterDescription(c: CharacterForPrompt): string {
  const name = normalizeFragment(c.name);

  const bodyModel = normalizeFragment(c.bodyModel ?? '');
  const outfit = normalizeFragment(c.outfit ?? '');
  if (bodyModel && outfit) {
    // Body first (immutable identity), then the scene's clothing. `attirePhrase`
    // adds the leading "wearing" (and any needed article) without doubling it.
    return `${bodyModel}, ${attirePhrase(outfit)}`;
  }

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
  /**
   * When true (opt-in, per-book), append the fidelity instruction before the
   * trailing technical clause. Default false — off-path output is
   * byte-identical to omitting this flag.
   */
  mature?: boolean;
}): { prompt: string; negative: string } {
  const name = normalizeFragment(args.character.name);
  const description = renderCharacterDescription(args.character);
  const keyword = keywordOf(args.character);
  // Keyword leads the subject phrase: "{keyword}, {name}, {appearance}…". When
  // absent the leading segment is just "{name}" exactly as before (byte-identical).
  const head = keyword ? `${keyword}, ${name}` : name;
  const subject =
    description === name
      ? `A three-quarter character portrait of ${head}`
      : `A three-quarter character portrait of ${head}, ${description}`;

  const prompt = [
    sentence(subject),
    'Set against a neutral studio backdrop with soft ambient depth.',
    'Lit with even, soft studio lighting.',
    sentence(`Rendered as ${normalizeFragment(args.style.promptFragment)}`),
    'A focused, dignified character study.',
    ...(args.mature ? [IMAGING_FIDELITY_INSTRUCTION] : []),
    TECHNICAL_CLAUSE,
  ].join(' ');

  return { prompt, negative: '' };
}

interface SceneParts {
  moment: string;
  characters: string | null;
  setting: string | null;
  lighting: string;
  mood: string | null;
  /** Fidelity instruction when mature is on; null otherwise. */
  fidelity: string | null;
  shot: string;
  style: string;
  technical: string;
}

/**
 * Joins the scaffold in Z-Image's director order:
 * [action] [cast] [setting] [lighting] [mood] [fidelity?] [shot] [style]
 * [technical]. The subject/action leads (early tokens steer composition) and
 * the camera framing moves to just before the style; null slots are omitted.
 * The technical clause always trails last.
 */
function joinSceneParts(parts: SceneParts): string {
  return [
    parts.moment,
    parts.characters,
    parts.setting,
    parts.lighting,
    parts.mood,
    parts.fidelity,
    parts.shot,
    parts.style,
    parts.technical,
  ]
    .filter((p): p is string => p !== null)
    .join(' ');
}

/**
 * Scene illustration prompt as camera-structured prose in Z-Image's director
 * order: the key visual moment as the action leads (falling back to the
 * summary, then a generic beat), then the present cast (name + verbatim
 * appearance, capped at MAX_SCENE_CHARACTERS), the setting, explicit lighting
 * derived from `timeOfDay`, the mood, the camera shot derived from `sceneType`
 * (via `shotFor`, positioned just before the style), the style preset as the
 * medium, and the trailing technical clause.
 *
 * Under length pressure it drops character descriptions first (keeping the
 * names), then the setting clause — never the key moment, lighting, shot, or
 * style. The negative is empty (inert on Z-Image Turbo). Deterministic.
 */
export function buildScenePrompt(args: {
  scene: SceneForPrompt;
  characters: CharacterForPrompt[];
  style: StyleFragment;
  /**
   * When true (opt-in, per-book), fold the fidelity instruction in before the
   * trailing technical clause. Default false — off-path output is
   * byte-identical to omitting this flag.
   */
  mature?: boolean;
  /**
   * Planned LLM importance (1–5) of this moment, when known. Pulls a tight
   * 1–2 character framing slightly tighter still. Absent → framing depends on
   * count + sceneType only (byte-identical to omitting this flag).
   */
  importance?: number | null;
}): { prompt: string; negative: string } {
  const { scene, style } = args;

  const moment = scene.keyVisualMoment?.trim() || scene.summary?.trim() || SCENE_FALLBACK;
  const setting = scene.setting?.trim()
    ? sentence(`Setting: ${normalizeFragment(scene.setting)}`)
    : null;

  const lighting = sentence(`Lit with ${lightingFor(scene.timeOfDay)}`);

  const mood = scene.mood?.trim()
    ? sentence(`${normalizeFragment(scene.mood)} mood`)
    : null;

  const present = args.characters.slice(0, MAX_SCENE_CHARACTERS);
  // Position phrases only when 2+ share the frame; null otherwise (1 char →
  // byte-identical to the no-hint output). Indexed by cast-array order.
  const positions = POSITION_HINTS[present.length] ?? null;
  const cast = present.map((c, i) => ({
    name: normalizeFragment(c.name),
    description: capWords(renderCharacterDescription(c), MAX_SCENE_DESCRIPTION_WORDS),
    // Spatial hint for THIS character (cast-array order); null when 1 char.
    position: positions?.[i] ?? null,
    // Trigger keyword bound to THIS character; '' when none.
    keyword: keywordOf(c),
  }));

  const castClause = (withDescriptions: boolean): string | null => {
    if (cast.length === 0) return null;
    const rendered = cast.map((c) => {
      // The keyword always leads this character's clause so it stays bound to
      // them even when the description is dropped under length pressure (never
      // orphaned). No keyword → byte-identical to the prior clause.
      const head = c.keyword ? `${c.keyword} ${c.name}` : c.name;
      const hasTraits = c.description && c.description !== c.name;
      if (withDescriptions && hasTraits) {
        // Position hint weaves into the parenthetical after the verbatim
        // appearance, so it drops with the description under length pressure.
        const inner = c.position ? `${c.description}, ${c.position}` : c.description;
        return `${head} (${inner})`;
      }
      // No traits to show (name-only, or descriptions dropped): keep the
      // position hint attached to the name so 2+ characters still separate.
      return withDescriptions && c.position ? `${head}, ${c.position}` : head;
    });
    const list =
      rendered.length === 1
        ? rendered[0]
        : `${rendered.slice(0, -1).join(', ')} and ${rendered[rendered.length - 1]}`;
    return sentence(`Featuring ${list}`);
  };

  const base: SceneParts = {
    moment: sentence(moment),
    characters: castClause(true),
    setting,
    lighting,
    mood,
    fidelity: args.mature ? IMAGING_FIDELITY_INSTRUCTION : null,
    // Framing factors how many characters are in frame (+ importance), so 1–2
    // character beats are tight enough for large faces and groups widen to fit.
    shot: sentence(
      `Composed as ${framingFor(scene.sceneType, {
        characterCount: present.length,
        importance: args.importance,
      })}`,
    ),
    style: sentence(`Rendered as ${normalizeFragment(style.promptFragment)}`),
    technical: TECHNICAL_CLAUSE,
  };

  // Drop order under length pressure: character descriptions (keep names),
  // then the setting clause. The key moment, lighting, mood, shot, style, and
  // (when on) the fidelity instruction survive.
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

/**
 * Wardrobe extraction (Phase 2, chunk 2) — pure functions.
 *
 * The wardrobe stage turns a character's structured profile + scattered
 * per-scene clothing notes into:
 *   - a clothing-stripped `bodyModel` descriptor (composeBodyModel), and
 *   - a set of appearance states (one `base` + N `additional` outfits),
 *     consolidated and clamped to exactly one base (dedupeOutfits +
 *     clampSingleBase).
 *
 * The spike (see design doc "Extraction spike findings") proved the dominant
 * quality lever is the DATA, not the prompt: the raw per-scene signal
 * (`description_delta` / `state_changes`) is mostly *transient state* deltas
 * (injuries, blood, wetness, dirt, mood, mussed hair), and BOTH 8b and 14b
 * treat those as outfits. So we strip transient states deterministically
 * (stripTransientStates) BEFORE any outfit LLM call, and we never trust the
 * LLM for the single-base choice (clampSingleBase, max scene mentions).
 *
 * Everything here is pure (no IO) so it is fully unit-testable; the LLM call
 * itself lives in wardrobe-extract.ts and is mocked in unit tests.
 */

import type { CharacterProfile } from '../analysis/profile-schema';

/**
 * Physical trait fields that compose the body model, in stable emission order.
 * Deliberately EXCLUDES `attire`: the body model is clothing-stripped so only
 * the per-state wardrobe descriptor varies the look.
 */
const BODY_FIELD_ORDER = ['age', 'build', 'skin', 'hair', 'eyes', 'distinguishing'] as const;

/** Lowercases + whitespace-normalizes + trims trailing punctuation. */
function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').replace(/[.,;]+$/, '').toLowerCase();
}

// ---------------------------------------------------------------------------
// Transient-state vocabulary
//
// Words/patterns that mark a TRANSIENT state (a one-scene condition), never a
// stable outfit. The spike showed the per-scene signal is dominated by these,
// and the LLM happily mints "outfits" from them ("blood-soaked", "tousled",
// "furious"). We strip them so only durable clothing reaches the extractor.
//
// Grouped by rationale; each group is a hard, conservative keyword set — a
// term is here only if it can never sensibly describe a garment by itself.
// ---------------------------------------------------------------------------

/** Injuries, wounds, blood — the largest transient class in the spike data. */
const INJURY_WORDS = [
  'injured',
  'injury',
  'wound',
  'wounded',
  'bleeding',
  'bloody',
  'bloodied',
  'blood-soaked',
  'blood',
  'gash',
  'cut',
  'bruise',
  'bruised',
  'battered',
  'scratched',
  'scraped',
  'broken',
  'limping',
  'limp',
  'burned',
  'burnt',
  'scorched',
];

/** Wetness / dirt / sweat — environmental grime, not attire. */
const GRIME_WORDS = [
  'soaked',
  'drenched',
  'wet',
  'damp',
  'dripping',
  'muddy',
  'mud',
  'dirty',
  'dirt',
  'grimy',
  'dusty',
  'dust',
  'sweaty',
  'sweat',
  'sweating',
  'filthy',
  'soiled',
  // NB: bare 'stained' is intentionally excluded — it doubles as a permanent
  // mark ("ink-stained fingers"); blood/mud are caught by their own words.
];

/** Grooming / hair-disarray states. */
const GROOMING_WORDS = ['tousled', 'mussed', 'messy', 'dishevelled', 'disheveled', 'ruffled'];

/** Mood / emotion / facial expression — never clothing. */
const MOOD_WORDS = [
  'furious',
  'angry',
  'sad',
  'crying',
  'tearful',
  'tear-streaked',
  'weeping',
  'frightened',
  'scared',
  'terrified',
  'nervous',
  'anxious',
  'exhausted',
  'tired',
  // NB: 'pale'/'flushed' are deliberately NOT here — they double as legitimate
  // skin descriptors ("pale skin"); treating them as transient would corrupt
  // body models. Mood is better captured by the unambiguous words below.
  'trembling',
  'shaking',
  'smiling',
  'frowning',
  'grim',
];

const TRANSIENT_WORDS = [
  ...INJURY_WORDS,
  ...GRIME_WORDS,
  ...GROOMING_WORDS,
  ...MOOD_WORDS,
];

/**
 * Matches a transient word as a whole token, including when it is the prefix
 * of a hyphenated compound ("blood-soaked", "tear-streaked"). Word-boundary
 * anchored so "scarlet" is not flagged by "scar"-like fragments.
 */
const TRANSIENT_RE = new RegExp(
  `(?:^|[^a-z])(?:${TRANSIENT_WORDS.join('|')})(?:-[a-z]+)?(?=[^a-z]|$)`,
  'gi',
);

/** Non-stateful tester for "does this fragment contain a transient word?". */
const TRANSIENT_TEST = new RegExp(
  `(?:^|[^a-z])(?:${TRANSIENT_WORDS.join('|')})(?:-[a-z]+)?(?=[^a-z]|$)`,
  'i',
);

/**
 * Strips transient-state language from a per-scene clothing signal, returning
 * the cleaned clothing text or `null` when nothing durable remains.
 *
 * Strategy: split into comma/`and`-delimited clauses, drop any clause that is
 * dominated by transient words, then within surviving clauses remove leftover
 * transient adjectives. Leading articles/conjunctions left dangling by the
 * removal are cleaned up. A clause that becomes empty (it was purely
 * transient) is dropped. If nothing clothing-like survives, return null so the
 * caller feeds an empty signal to the extractor rather than mood noise.
 *
 * Pure. The keyword set above is the spec; see group comments for rationale.
 */
export function stripTransientStates(signal: string): string | null {
  const trimmed = signal.trim();
  if (!trimmed) return null;

  // Clause-level split on commas and standalone "and"/"with"/"&".
  const clauses = trimmed
    .split(/\s*,\s*|\s+and\s+|\s*&\s*/i)
    .map((c) => c.trim())
    .filter(Boolean);

  const cleaned: string[] = [];
  for (const clause of clauses) {
    if (!hasClothingNoun(clause)) continue; // no garment -> pure transient clause
    const transientHits = (clause.match(TRANSIENT_RE) ?? []).length;

    // Remove transient adjectives embedded in a surviving clothing clause.
    let kept = clause;
    if (transientHits > 0) {
      kept = clause.replace(TRANSIENT_RE, ' ').replace(/\s+/g, ' ').trim();
      // The transient removal can leave a dangling leading article/conjunction
      // ("and bloodied red gown" -> "and red gown"); drop it. Only done when a
      // transient word was actually removed, so clean signals keep their article.
      kept = kept.replace(/^(?:and|with|of)\s+/i, '').trim();
    }

    // A clause whose only surviving content is a bare generic clothing word
    // ("clothes", "outfit") carries no real wardrobe signal — drop it.
    if (isBareGenericClothing(kept)) continue;
    if (kept) cleaned.push(kept);
  }

  if (cleaned.length === 0) return null;
  return cleaned.join(', ') || null;
}

/** Clothing/garment nouns used to decide whether a clause is wearable. */
export const CLOTHING_NOUNS =
  /\b(shirt|blouse|tunic|dress|gown|robe|cloak|coat|jacket|cape|vest|waistcoat|trousers|pants|breeches|skirt|leggings|boots?|shoes?|gloves?|hat|cap|hood|scarf|belt|armor|armour|uniform|suit|outfit|attire|clothes|clothing|garb|garment|sweater|cardigan|sash|apron|smock|frock|kimono|sari|toga|doublet|jerkin|tabard|mantle|shawl|veil|corset|bodice|petticoat|nightgown|pajamas|pyjamas|overalls|jumpsuit|kilt|poncho|parka|anorak|blazer|tuxedo|jeans|shorts|t-shirt|tshirt|hoodie|sweatshirt|stockings|tights|sandals?|slippers|heels|crown|tiara|helmet|helm|breastplate|chainmail|chestplate|wear|wearing|clad|dressed)\b/i;

function hasClothingNoun(clause: string): boolean {
  return CLOTHING_NOUNS.test(clause);
}

/** Generic clothing words that, alone, describe no specific outfit. */
const GENERIC_CLOTHING =
  /^(?:(?:a|an|the|her|his|their)\s+)?(?:clothes|clothing|garb|outfit|attire|garment|garments|wear|dressed|clad)$/i;

function isBareGenericClothing(text: string): boolean {
  return GENERIC_CLOTHING.test(text.trim());
}

// ---------------------------------------------------------------------------
// Body model
// ---------------------------------------------------------------------------

/**
 * Composes a deterministic, clothing-stripped body descriptor from the
 * structured profile fields (age, build, skin, hair, eyes, distinguishing).
 * `attire` is never included. Each field is normalized; any comma-item that
 * carries clothing/wearing language (the LLM sometimes leaks attire into
 * "immutable" fields — the spike observed this) is dropped at item
 * granularity. Returns '' for an all-null/empty profile.
 *
 * Pure: identical input always yields identical output.
 */
export function composeBodyModel(profile: CharacterProfile): string {
  const fragments: string[] = [];
  const seen = new Set<string>();

  for (const field of BODY_FIELD_ORDER) {
    const raw = profile[field];
    if (typeof raw !== 'string') continue;
    const items = normalize(raw)
      .split(/\s*,\s*/)
      .filter(Boolean)
      // Defense in depth: drop any item that reads as clothing rather than a
      // body trait (e.g. "wearing a green cloak" leaked into distinguishing).
      .filter((item) => !CLOTHING_NOUNS.test(item))
      // Likewise drop transient states the profiler sometimes stores in
      // "immutable" fields (live data: "gash on his forehead" in
      // distinguishing). The body model must be stable across scenes.
      .filter((item) => !TRANSIENT_TEST.test(item))
      .filter((item) => !seen.has(item));
    for (const item of items) {
      seen.add(item);
      fragments.push(item);
    }
  }

  return fragments.join(', ');
}

// ---------------------------------------------------------------------------
// Outfit consolidation
// ---------------------------------------------------------------------------

/** A candidate outfit produced by the extractor, before consolidation. */
export interface RawOutfit {
  descriptor: string;
  sceneMentions: number;
}

/** A consolidated appearance state, post-clamp. */
export interface OutfitState {
  type: 'base' | 'additional';
  descriptor: string;
  isBase: boolean;
  sceneMentions: number;
}

/** Token set of a descriptor (lowercased content words, articles dropped). */
function tokenSet(descriptor: string): Set<string> {
  return new Set(
    normalize(descriptor)
      .split(/\s+/)
      .filter((w) => w && !/^(a|an|the|with|of|in|and)$/.test(w)),
  );
}

/**
 * Jaccard-ish containment: two outfit descriptors are near-duplicates when one
 * descriptor's content tokens are largely a subset of the other's. We use
 * containment (not symmetric Jaccard) so "green cloak" merges into "a long
 * green velvet cloak" — the shorter is a subset of the richer descriptor.
 */
function nearDuplicate(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const t of small) if (large.has(t)) shared++;
  // The smaller descriptor must be almost entirely contained in the larger.
  return shared / small.size >= 0.75;
}

/**
 * Dedup-merges near-duplicate clothing descriptors into a single canonical
 * outfit each, summing their scene mentions. The longer (more detailed)
 * descriptor wins as canonical. Empty descriptors are dropped. Genuinely
 * distinct outfits are preserved. Pure and order-stable.
 */
export function dedupeOutfits(outfits: RawOutfit[]): RawOutfit[] {
  const cleaned = outfits
    .map((o) => ({ descriptor: o.descriptor.trim(), sceneMentions: o.sceneMentions }))
    .filter((o) => o.descriptor.length > 0);

  const groups: Array<{ descriptor: string; sceneMentions: number; tokens: Set<string> }> = [];
  for (const o of cleaned) {
    const tokens = tokenSet(o.descriptor);
    const match = groups.find((g) => nearDuplicate(g.tokens, tokens));
    if (match) {
      match.sceneMentions += o.sceneMentions;
      // Keep the richer descriptor (more content tokens) as canonical.
      if (tokens.size > match.tokens.size) {
        match.descriptor = o.descriptor;
        match.tokens = tokens;
      }
    } else {
      groups.push({ descriptor: o.descriptor, sceneMentions: o.sceneMentions, tokens });
    }
  }

  return groups.map((g) => ({ descriptor: g.descriptor, sceneMentions: g.sceneMentions }));
}

/**
 * Single-base clamp: marks exactly ONE outfit as the base (`isBase: true`,
 * `type: 'base'`) — the one with the most scene mentions — and the rest as
 * `additional`. Ties break deterministically by descriptor (lexicographic) so
 * input order cannot change the chosen base. Never trusts the LLM for this.
 * Pure.
 */
export function clampSingleBase(outfits: RawOutfit[]): OutfitState[] {
  if (outfits.length === 0) return [];

  let baseIdx = 0;
  for (let i = 1; i < outfits.length; i++) {
    const cur = outfits[i]!;
    const best = outfits[baseIdx]!;
    if (
      cur.sceneMentions > best.sceneMentions ||
      (cur.sceneMentions === best.sceneMentions && cur.descriptor < best.descriptor)
    ) {
      baseIdx = i;
    }
  }

  return outfits.map((o, i) => ({
    type: i === baseIdx ? 'base' : 'additional',
    descriptor: o.descriptor,
    isBase: i === baseIdx,
    sceneMentions: o.sceneMentions,
  }));
}

/**
 * Appearance-token compilation: the stable, deterministic prompt fragment
 * reused verbatim in every image prompt featuring a character. Pure (no IO).
 */

import type { CharacterProfile } from '../analysis/profile-schema';

/** The visual trait fields, in the stable order they are emitted. */
export const APPEARANCE_FIELD_ORDER = [
  'age',
  'build',
  'skin',
  'hair',
  'eyes',
  'distinguishing',
  'attire',
] as const;

export type AppearanceField = (typeof APPEARANCE_FIELD_ORDER)[number];

export type AppearanceTraits = Partial<Pick<CharacterProfile, AppearanceField>>;

/** Soft word cap for the whole token (image-prompt budget). */
export const MAX_APPEARANCE_WORDS = 40;

const countWords = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/** Lowercases and whitespace-normalizes one trait value. */
function normalizeFragment(value: string): string {
  return value.trim().replace(/\s+/g, ' ').replace(/[.,;]+$/, '').toLowerCase();
}

/** Exact-match nullish values (after trim+lowercase). */
const NULLISH_EXACT = new Set(['', 'null', 'none']);

/**
 * Placeholder patterns detected ANYWHERE in a value (live data:
 * 'typical/default outfit (not specified)'), not just exact matches.
 */
const PLACEHOLDER_RE = /not specified|not described|default outfit|\bunknown\b|\bn\/a\b/i;

/**
 * Hedging/meta markers: the model annotating its own uncertainty instead of
 * stating a trait (live data: 'possibly a limp from injuries (implied by
 * multiple mentions)'). Such a value is commentary, not appearance — drop it.
 */
const HEDGING_RE = /\bpossibly\b|\bimplied\b|\bmentioned\b|\bsuggests?\b|\bmay have\b/i;

/**
 * Bare color/light-family adjectives that are meaningless without a noun
 * (live data: 'Sage: light'). Only degenerate for fields that do NOT get a
 * label suffix downstream — 'light' as hair becomes 'light hair' and is fine.
 */
const BARE_COLOR_ADJECTIVES = new Set([
  'light',
  'dark',
  'brown',
  'black',
  'white',
  'gray',
  'grey',
  'blond',
  'blonde',
  'red',
  'pale',
  'fair',
  'tan',
  'auburn',
  'golden',
  'silver',
]);

/** Fields whose values get a label suffix in prompt rendering. */
const LABELED_FIELDS: ReadonlySet<AppearanceField> = new Set(['hair', 'eyes', 'skin', 'build']);

/**
 * Sanitizes one profile trait value: trims it, and returns null for empty/
 * nullish values, placeholder echoes ('not specified', 'default outfit', …,
 * detected contains-style), hedging commentary ('possibly …', '(implied …'),
 * and degenerate single bare color adjectives on fields that get no label
 * suffix. Case is preserved for surviving values. Pure.
 */
export function sanitizeTraitValue(
  value: string | null | undefined,
  field: AppearanceField,
): string | null {
  const trimmed = value?.trim().replace(/\s+/g, ' ') ?? '';
  if (NULLISH_EXACT.has(trimmed.toLowerCase())) return null;
  if (PLACEHOLDER_RE.test(trimmed)) return null;
  if (HEDGING_RE.test(trimmed)) return null;
  if (!LABELED_FIELDS.has(field) && BARE_COLOR_ADJECTIVES.has(trimmed.toLowerCase())) {
    return null;
  }
  return trimmed;
}

/**
 * Compiles `'Name: age, build, skin, hair, eyes, distinguishing, attire'`
 * (nulls skipped, fragments lowercased, name preserved). Deterministic:
 * identical input always yields the identical token. Values are sanitized
 * (placeholders/hedging/degenerate adjectives dropped — defense in depth;
 * profiles.ts sanitizes before storing) and comma-separated items repeated
 * across fields are deduped case-insensitively, first occurrence winning
 * (live data: 'gray beard, scars, gray beard, scars'). The word cap is
 * enforced by dropping whole fields that would overflow it — a field is
 * never cut mid-phrase. An empty profile yields just the name.
 */
export function compileAppearanceToken(name: string, profile: AppearanceTraits | null): string {
  const displayName = name.trim().replace(/\s+/g, ' ');
  const fragments: string[] = [];
  const seenItems = new Set<string>();
  let words = countWords(displayName);

  for (const field of APPEARANCE_FIELD_ORDER) {
    const raw = profile?.[field];
    if (typeof raw !== 'string') continue;
    const sanitized = sanitizeTraitValue(raw, field);
    if (!sanitized) continue;
    // Dedupe at comma-item granularity so a phrase echoed into two fields
    // (or repeated within one) is emitted exactly once.
    const items = normalizeFragment(sanitized)
      .split(/\s*,\s*/)
      .filter(Boolean)
      .filter((item, idx, arr) => !seenItems.has(item) && arr.indexOf(item) === idx);
    if (items.length === 0) continue;
    const fragment = items.join(', ');
    const fragmentWords = countWords(fragment);
    // Whole-field truncation: skip any field that would blow the budget,
    // but keep trying later (possibly shorter) fields.
    if (words + fragmentWords > MAX_APPEARANCE_WORDS) continue;
    words += fragmentWords;
    fragments.push(fragment);
    for (const item of items) seenItems.add(item);
  }

  return fragments.length > 0 ? `${displayName}: ${fragments.join(', ')}` : displayName;
}

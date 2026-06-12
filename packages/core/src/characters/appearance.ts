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

export type AppearanceTraits = Partial<
  Pick<CharacterProfile, (typeof APPEARANCE_FIELD_ORDER)[number]>
>;

/** Soft word cap for the whole token (image-prompt budget). */
export const MAX_APPEARANCE_WORDS = 40;

const countWords = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/** Lowercases and whitespace-normalizes one trait value. */
function normalizeFragment(value: string): string {
  return value.trim().replace(/\s+/g, ' ').replace(/[.,;]+$/, '').toLowerCase();
}

/**
 * Compiles `'Name: age, build, skin, hair, eyes, distinguishing, attire'`
 * (nulls skipped, fragments lowercased, name preserved). Deterministic:
 * identical input always yields the identical token. The word cap is
 * enforced by dropping whole fields that would overflow it — a field is
 * never cut mid-phrase. An empty profile yields just the name.
 */
export function compileAppearanceToken(name: string, profile: AppearanceTraits | null): string {
  const displayName = name.trim().replace(/\s+/g, ' ');
  const fragments: string[] = [];
  let words = countWords(displayName);

  for (const field of APPEARANCE_FIELD_ORDER) {
    const raw = profile?.[field];
    if (typeof raw !== 'string') continue;
    const fragment = normalizeFragment(raw);
    if (!fragment) continue;
    const fragmentWords = countWords(fragment);
    // Whole-field truncation: skip any field that would blow the budget,
    // but keep trying later (possibly shorter) fields.
    if (words + fragmentWords > MAX_APPEARANCE_WORDS) continue;
    words += fragmentWords;
    fragments.push(fragment);
  }

  return fragments.length > 0 ? `${displayName}: ${fragments.join(', ')}` : displayName;
}

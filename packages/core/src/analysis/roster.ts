/**
 * Pure roster-matching helpers for the analysis stage: deciding whether a
 * character name reported by the LLM refers to an already-known character.
 */

/** Display normalization: trim + collapse internal whitespace (case kept). */
export function normalizeCharacterName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Matching key: lowercased, diacritics-stripped, whitespace-collapsed. */
export function nameKey(name: string): string {
  return normalizeCharacterName(name)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/**
 * Candidate names extracted from an LLM-reported character name. Small
 * models often emit compound forms like 'Trystan (The Villain)' or
 * 'The Villain (Trystan)'; both halves should be tried against the roster.
 * Order: full normalized name, then the part before the parenthetical, then
 * the parenthetical content.
 */
export function candidateNames(raw: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const n = normalizeCharacterName(s);
    if (n && !out.includes(n)) out.push(n);
  };
  const full = normalizeCharacterName(raw);
  push(full);
  const m = full.match(/^(.*?)\s*\(([^)]*)\)$/);
  if (m) {
    push(m[1]!);
    push(m[2]!);
  }
  return out;
}

/**
 * Splits a compound LLM-reported name like 'The Villain (Trystan)' into a
 * canonical display name plus aliases (the remaining candidate forms).
 *
 * Canonical-name heuristic: among the two fragments (the part before the
 * parenthetical and the parenthetical content, in that order), prefer the
 * FIRST one that looks like a personal name — i.e. does not start with
 * 'the '. Epithets ('The Villain') thus become aliases regardless of
 * position. When both fragments look personal ('Blade (Bladeworth
 * Maverine)') the first one wins — we deliberately do not rank competing
 * personal names. When no fragment qualifies, the first fragment wins.
 */
export function splitCompoundName(raw: string): { name: string; aliases: string[] } {
  const names = candidateNames(raw);
  if (names.length === 0) return { name: '', aliases: [] };
  if (names.length === 1) return { name: names[0]!, aliases: [] };
  const fragments = names.slice(1);
  const name = fragments.find((n) => !/^the\s/i.test(n)) ?? fragments[0]!;
  return { name, aliases: names.filter((n) => n !== name) };
}

/**
 * Finds the roster entry whose name or any alias matches `name`
 * (case- and diacritics-insensitive).
 */
export function findRosterMatch<T extends { name: string; aliases: string[] }>(
  roster: readonly T[],
  name: string,
): T | undefined {
  const key = nameKey(name);
  if (!key) return undefined;
  return roster.find(
    (entry) => nameKey(entry.name) === key || entry.aliases.some((a) => nameKey(a) === key),
  );
}

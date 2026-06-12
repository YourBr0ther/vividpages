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

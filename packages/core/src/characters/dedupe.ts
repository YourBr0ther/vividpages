/**
 * Pure character-deduplication logic (no DB, no network).
 *
 * Resolution strategy, in order:
 *   1. Exact-normalized name/alias equality (incl. compound-name fragments,
 *      a stripped leading 'the ', and stripped honorifics — match-only;
 *      display forms are preserved). Cheap and embedding-free.
 *   2. Otherwise, cosine similarity between embeddings of
 *      buildEmbeddingText() — the caller embeds and calls
 *      resolveWithEmbedding().
 *
 * Token-subset matching ('Trystan Maverine' vs 'Trystan', 'Evie Sage' vs
 * 'Sage') is EXPLICITLY out of scope for the name path: surnames collide
 * with unrelated first names ('Evie Sage' vs a separate character 'Sage'),
 * so those cases are left to the embedding path, where the description
 * sample disambiguates.
 */

import { candidateNames, nameKey, normalizeCharacterName, splitCompoundName } from '../analysis/roster';

export interface CharacterCandidate {
  name: string;
  aliases: string[];
  /** Short visual/role description used to disambiguate embeddings. */
  descriptionSample: string | null;
}

export interface ExistingCharacter extends CharacterCandidate {
  id: string;
  embedding: number[] | null;
}

export type Resolution =
  | { kind: 'existing'; id: string; addAliases: string[] }
  | { kind: 'new' };

export interface ResolveOptions {
  /** Minimum (inclusive) cosine similarity for an embedding match. */
  threshold?: number;
}

export const DEFAULT_SIMILARITY_THRESHOLD = 0.85;

/** Honorifics stripped (leading position, match-only). */
const HONORIFIC_RE = /^(?:mr|mrs|ms|lady|lord|sir|dr)\.?\s+/;

/**
 * Cosine similarity of two equal-dimension vectors. Zero vectors yield 0
 * (no direction — never similar to anything) rather than NaN.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: dimension mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Stable text representation used for embedding a character:
 * 'name (aka alias1, alias2): description sample'. Aliases equal to the
 * name are dropped; the aka clause and description are omitted when empty.
 *
 * The result is LOWERCASED on purpose: Ollama's nomic-embed-text tokenizer
 * (observed on Ollama 0.24.0) maps capitalized out-of-vocabulary words to an
 * identical [UNK]-like embedding — 'Becky' and 'Evie' embed at cosine 1.000,
 * which would false-merge unrelated characters at any threshold. The
 * lowercase forms tokenize into subwords and embed distinctly.
 */
export function buildEmbeddingText(candidate: CharacterCandidate): string {
  const name = normalizeCharacterName(candidate.name);
  const seen = new Set([nameKey(name)]);
  const aliases: string[] = [];
  for (const raw of candidate.aliases) {
    const alias = normalizeCharacterName(raw);
    const key = nameKey(alias);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }
  const aka = aliases.length > 0 ? ` (aka ${aliases.join(', ')})` : '';
  const desc = candidate.descriptionSample?.trim();
  return `${name}${aka}${desc ? `: ${desc}` : ''}`.toLowerCase();
}

/**
 * All match keys for one display name: the normalized key, compound-name
 * fragments, plus 'the '-stripped and honorific-stripped variants of each.
 */
function matchKeys(name: string): Set<string> {
  const keys = new Set<string>();
  for (const variant of candidateNames(name)) {
    const key = nameKey(variant);
    if (!key) continue;
    keys.add(key);
    const deThe = key.replace(/^the\s+/, '');
    if (deThe) keys.add(deThe);
    const deHonorific = key.replace(HONORIFIC_RE, '');
    if (deHonorific) keys.add(deHonorific);
  }
  return keys;
}

function allNames(c: CharacterCandidate): string[] {
  return [c.name, ...c.aliases];
}

function combinedMatchKeys(c: CharacterCandidate): Set<string> {
  const keys = new Set<string>();
  for (const name of allNames(c)) {
    for (const key of matchKeys(name)) keys.add(key);
  }
  return keys;
}

/**
 * Candidate display names (compound fragments included) not already present
 * on `target` by exact-normalized equality. Honorific/'the' stripping is NOT
 * applied here: 'Mr. Maverine' is still worth recording as an alias of
 * 'Maverine'.
 */
function aliasesToAdd(candidate: CharacterCandidate, target: ExistingCharacter): string[] {
  const present = new Set(allNames(target).map(nameKey));
  const out: string[] = [];
  const split = splitCompoundName(candidate.name);
  for (const raw of [split.name, ...split.aliases, ...candidate.aliases]) {
    const display = normalizeCharacterName(raw);
    const key = nameKey(display);
    if (!key || present.has(key)) continue;
    present.add(key);
    out.push(display);
  }
  return out;
}

function findNameMatch(
  candidate: CharacterCandidate,
  existing: ExistingCharacter[],
): Resolution | undefined {
  const candidateKeys = combinedMatchKeys(candidate);
  for (const e of existing) {
    const existingKeys = combinedMatchKeys(e);
    for (const key of candidateKeys) {
      if (existingKeys.has(key)) {
        return { kind: 'existing', id: e.id, addAliases: aliasesToAdd(candidate, e) };
      }
    }
  }
  return undefined;
}

/**
 * Name-only resolution. Returns 'needs-embedding' when no name/alias match
 * exists — the caller should embed buildEmbeddingText(candidate) and call
 * resolveWithEmbedding().
 */
export function resolveCharacter(
  candidate: CharacterCandidate,
  existing: ExistingCharacter[],
  _opts?: ResolveOptions,
): Resolution | 'needs-embedding' {
  return findNameMatch(candidate, existing) ?? 'needs-embedding';
}

/**
 * Full resolution with an embedding in hand: name match first (free), then
 * best cosine similarity against existing characters (null embeddings are
 * skipped). Similarity >= threshold (default 0.85) merges into the best
 * match; ties resolve to the highest similarity, otherwise the character
 * is new.
 */
export function resolveWithEmbedding(
  candidate: CharacterCandidate & { embedding: number[] },
  existing: ExistingCharacter[],
  opts?: ResolveOptions,
): Resolution {
  const nameMatch = findNameMatch(candidate, existing);
  if (nameMatch) return nameMatch;

  const threshold = opts?.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  let best: ExistingCharacter | undefined;
  let bestSim = -Infinity;
  for (const e of existing) {
    if (!e.embedding) continue;
    const sim = cosineSimilarity(candidate.embedding, e.embedding);
    if (sim > bestSim) {
      bestSim = sim;
      best = e;
    }
  }
  if (best && bestSim >= threshold) {
    return { kind: 'existing', id: best.id, addAliases: aliasesToAdd(candidate, best) };
  }
  return { kind: 'new' };
}

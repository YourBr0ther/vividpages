import { describe, expect, it } from 'vitest';

import {
  buildEmbeddingText,
  cosineSimilarity,
  resolveCharacter,
  resolveWithEmbedding,
  type CharacterCandidate,
  type ExistingCharacter,
} from '../src/characters/dedupe';

/** Unit vector at angle theta from [1, 0]: cosine vs [1, 0] is exactly cos(theta). */
const unitWithCosine = (c: number): number[] => [c, Math.sqrt(1 - c * c)];

const candidate = (over: Partial<CharacterCandidate> = {}): CharacterCandidate => ({
  name: 'Kingsley',
  aliases: [],
  descriptionSample: null,
  ...over,
});

const existing = (over: Partial<ExistingCharacter> = {}): ExistingCharacter => ({
  id: 'id-1',
  name: 'Trystan',
  aliases: [],
  descriptionSample: null,
  embedding: null,
  ...over,
});

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 12);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 12);
  });

  it('is -1 for anti-parallel vectors', () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 12);
  });

  it('guards zero vectors by returning 0', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
    expect(cosineSimilarity([1, 2], [0, 0])).toBe(0);
  });

  it('throws on dimension mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/dimension/i);
  });
});

describe('buildEmbeddingText', () => {
  // Output is lowercased: Ollama's nomic-embed-text tokenizer maps
  // capitalized out-of-vocabulary names to identical [UNK]-like vectors
  // ('Becky' vs 'Evie' embed at cosine 1.000 on Ollama 0.24.0), while the
  // lowercase forms embed distinctly. See T20 experiment.
  it('uses just the lowercased name when there is nothing else', () => {
    expect(buildEmbeddingText(candidate({ name: 'Sage' }))).toBe('sage');
  });

  it('appends aliases in an aka clause', () => {
    expect(buildEmbeddingText(candidate({ name: 'Sage', aliases: ['Evie', 'Evie Sage'] }))).toBe(
      'sage (aka evie, evie sage)',
    );
  });

  it('appends the description sample after a colon', () => {
    expect(
      buildEmbeddingText(
        candidate({ name: 'Sage', descriptionSample: 'bright yellow skirts, vanilla scent' }),
      ),
    ).toBe('sage: bright yellow skirts, vanilla scent');
  });

  it('combines name, aliases and description in a stable format', () => {
    expect(
      buildEmbeddingText(
        candidate({
          name: 'Evie',
          aliases: ['Evangelina Sage'],
          descriptionSample: 'Assistant, lavender hair',
        }),
      ),
    ).toBe('evie (aka evangelina sage): assistant, lavender hair');
  });

  it('normalizes whitespace and drops aliases equal to the name', () => {
    expect(buildEmbeddingText(candidate({ name: '  Evie  Sage ', aliases: ['evie sage'] }))).toBe(
      'evie sage',
    );
  });
});

describe('resolveCharacter (name/alias path)', () => {
  it('matches an exact normalized name without needing an embedding', () => {
    const e = existing({ id: 'trystan-id' });
    expect(resolveCharacter(candidate({ name: '  trystan ' }), [e])).toEqual({
      kind: 'existing',
      id: 'trystan-id',
      addAliases: [],
    });
  });

  it('matches a candidate name against an existing alias (short-circuit, embedding-free)', () => {
    const e = existing({ id: 'trystan-id', aliases: ['The Villain'] });
    expect(resolveCharacter(candidate({ name: 'the villain' }), [e])).toEqual({
      kind: 'existing',
      id: 'trystan-id',
      addAliases: [],
    });
  });

  it('matches a candidate alias against an existing name', () => {
    const e = existing({ id: 'trystan-id' });
    const result = resolveCharacter(candidate({ name: 'The Villain', aliases: ['Trystan'] }), [e]);
    expect(result).toEqual({ kind: 'existing', id: 'trystan-id', addAliases: ['The Villain'] });
  });

  it('strips honorifics for matching only, keeping the honorific form as a new alias', () => {
    const e = existing({ id: 'mav-id', name: 'Maverine' });
    expect(resolveCharacter(candidate({ name: 'Mr. Maverine' }), [e])).toEqual({
      kind: 'existing',
      id: 'mav-id',
      addAliases: ['Mr. Maverine'],
    });
  });

  it('strips honorifics on the existing side too', () => {
    const e = existing({ id: 'err-id', name: 'Lady Erring' });
    expect(resolveCharacter(candidate({ name: 'Erring' }), [e])).toEqual({
      kind: 'existing',
      id: 'err-id',
      addAliases: ['Erring'],
    });
  });

  it("strips a leading 'the ' for matching", () => {
    const e = existing({ id: 'v-id', name: 'Villain' });
    expect(resolveCharacter(candidate({ name: 'The Villain' }), [e])).toEqual({
      kind: 'existing',
      id: 'v-id',
      addAliases: ['The Villain'],
    });
  });

  it('matches compound candidate names through their fragments', () => {
    const e = existing({ id: 'trystan-id' });
    expect(resolveCharacter(candidate({ name: 'The Villain (Trystan)' }), [e])).toEqual({
      kind: 'existing',
      id: 'trystan-id',
      addAliases: ['The Villain (Trystan)', 'The Villain'],
    });
  });

  it('does NOT match by token subset — full-name vs first-name goes to embeddings', () => {
    // 'Trystan Maverine' vs 'Trystan' and 'Evie Sage' vs 'Sage' are NOT
    // name matches: token-subset matching is explicitly out of scope
    // ('Evie Sage' vs the unrelated 'Sage' would false-positive).
    expect(resolveCharacter(candidate({ name: 'Trystan Maverine' }), [existing()])).toBe(
      'needs-embedding',
    );
    expect(
      resolveCharacter(candidate({ name: 'Evie Sage' }), [existing({ name: 'Sage' })]),
    ).toBe('needs-embedding');
  });

  it('omits addAliases already present on the existing character (case-insensitive)', () => {
    const e = existing({ id: 'trystan-id', aliases: ['The Villain'] });
    const result = resolveCharacter(
      candidate({ name: 'TRYSTAN', aliases: ['the villain', 'Boss'] }),
      [e],
    );
    expect(result).toEqual({ kind: 'existing', id: 'trystan-id', addAliases: ['Boss'] });
  });

  it('returns needs-embedding when nothing matches by name', () => {
    expect(resolveCharacter(candidate(), [existing()])).toBe('needs-embedding');
  });

  it('returns needs-embedding for an empty roster', () => {
    expect(resolveCharacter(candidate(), [])).toBe('needs-embedding');
  });
});

describe('resolveWithEmbedding', () => {
  const probe = [1, 0];

  it('still short-circuits on a name match without comparing embeddings', () => {
    const e = existing({ id: 'trystan-id', embedding: unitWithCosine(0) });
    expect(
      resolveWithEmbedding({ ...candidate({ name: 'Trystan' }), embedding: probe }, [e]),
    ).toEqual({ kind: 'existing', id: 'trystan-id', addAliases: [] });
  });

  it('resolves to existing when best cosine is above the 0.85 default threshold', () => {
    const e = existing({ id: 'close-id', embedding: unitWithCosine(0.851) });
    expect(resolveWithEmbedding({ ...candidate(), embedding: probe }, [e])).toEqual({
      kind: 'existing',
      id: 'close-id',
      addAliases: ['Kingsley'],
    });
  });

  it('resolves to new when best cosine is below the threshold', () => {
    const e = existing({ id: 'far-id', embedding: unitWithCosine(0.849) });
    expect(resolveWithEmbedding({ ...candidate(), embedding: probe }, [e])).toEqual({
      kind: 'new',
    });
  });

  it('treats the threshold as inclusive', () => {
    const e = existing({ id: 'edge-id', embedding: probe });
    expect(
      resolveWithEmbedding({ ...candidate(), embedding: probe }, [e], { threshold: 1 }),
    ).toEqual({ kind: 'existing', id: 'edge-id', addAliases: ['Kingsley'] });
  });

  it('honors a custom threshold', () => {
    const e = existing({ id: 'mid-id', embedding: unitWithCosine(0.7) });
    const cand = { ...candidate(), embedding: probe };
    expect(resolveWithEmbedding(cand, [e], { threshold: 0.65 })).toEqual({
      kind: 'existing',
      id: 'mid-id',
      addAliases: ['Kingsley'],
    });
    expect(resolveWithEmbedding(cand, [e], { threshold: 0.75 })).toEqual({ kind: 'new' });
  });

  it('skips existing rows with null embeddings', () => {
    const noEmbedding = existing({ id: 'null-id', embedding: null });
    const far = existing({ id: 'far-id', embedding: unitWithCosine(0.2) });
    expect(
      resolveWithEmbedding({ ...candidate(), embedding: probe }, [noEmbedding, far]),
    ).toEqual({ kind: 'new' });
  });

  it('picks the highest-similarity match when several clear the threshold', () => {
    const good = existing({ id: 'good-id', embedding: unitWithCosine(0.9) });
    const better = existing({ id: 'better-id', embedding: unitWithCosine(0.97) });
    expect(
      resolveWithEmbedding({ ...candidate(), embedding: probe }, [good, better]),
    ).toEqual({ kind: 'existing', id: 'better-id', addAliases: ['Kingsley'] });
  });

  it('returns new for an empty roster', () => {
    expect(resolveWithEmbedding({ ...candidate(), embedding: probe }, [])).toEqual({
      kind: 'new',
    });
  });

  it('includes candidate aliases in addAliases on an embedding match', () => {
    const e = existing({ id: 'sage-id', name: 'Sage', embedding: unitWithCosine(0.95) });
    expect(
      resolveWithEmbedding(
        { ...candidate({ name: 'Evie Sage', aliases: ['Evie'] }), embedding: probe },
        [e],
      ),
    ).toEqual({ kind: 'existing', id: 'sage-id', addAliases: ['Evie Sage', 'Evie'] });
  });
});

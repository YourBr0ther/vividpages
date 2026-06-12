import { describe, expect, it } from 'vitest';
import { OllamaEmbedder } from '../src/embed/ollama';

const OLLAMA_URL = process.env.OLLAMA_URL;
const MODEL = process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text';

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

describe.skipIf(!OLLAMA_URL)('Ollama embeddings integration', () => {
  it('embeds a batch; related texts are closer than unrelated ones', async () => {
    const embedder = new OllamaEmbedder({ baseUrl: OLLAMA_URL!, model: MODEL });
    expect(embedder.dimensions).toBe(768);

    const [catA, catB, taxes] = await embedder.embed([
      'A small black cat curled up asleep on the windowsill.',
      'The little dark feline dozed in the window.',
      'Quarterly corporate tax filings are due at the end of the fiscal year.',
    ]);

    for (const vec of [catA!, catB!, taxes!]) {
      expect(vec).toHaveLength(768);
      expect(vec.every((x) => Number.isFinite(x))).toBe(true);
    }

    const related = cosine(catA!, catB!);
    const unrelated = cosine(catA!, taxes!);
    expect(related).toBeGreaterThan(unrelated);
  }, 60_000);

  it('returns [] for an empty batch without calling the server', async () => {
    const embedder = new OllamaEmbedder({ baseUrl: 'http://127.0.0.1:1', model: MODEL });
    await expect(embedder.embed([])).resolves.toEqual([]);
  });
});

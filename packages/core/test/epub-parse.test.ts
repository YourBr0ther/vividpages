import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { parseEpub } from '../src/epub/parse';

const FIXTURE_PATH = join(__dirname, 'fixtures/book.epub');
const fixtureExists = existsSync(FIXTURE_PATH);
if (!fixtureExists) {
  console.warn(
    `EPUB fixture missing at ${FIXTURE_PATH} — skipping real-book tests. ` +
      'Run `pnpm tsx scripts/make-fixtures.ts` from the repo root to generate it.',
  );
}

describe.skipIf(!fixtureExists)('parseEpub (real book fixture)', () => {
  // Parse once; the suite only reads the result.
  const parsed = parseEpub(readFileSync(FIXTURE_PATH));

  it('extracts metadata', async () => {
    const { metadata } = await parsed;
    expect(metadata.title).toBe('Assistant to the Villain');
    expect(metadata.author).toContain('Maehrer');
    expect(metadata.language).toBeDefined();
    // This calibre EPUB carries only uuid identifiers — no ISBN.
    expect(metadata.isbn).toBeUndefined();
  });

  it('extracts a sane number of chapters (Prologue + 60 chapters + marginal matter)', async () => {
    const { chapters } = await parsed;
    expect(chapters.length).toBeGreaterThanOrEqual(58);
    expect(chapters.length).toBeLessThanOrEqual(66);
  });

  it('produces non-empty html and sequential idx from 0', async () => {
    const { chapters } = await parsed;
    chapters.forEach((ch, i) => {
      expect(ch.idx).toBe(i);
      expect(ch.html.trim().length).toBeGreaterThan(0);
    });
  });

  it('titles at least 80% of chapters from the ncx', async () => {
    const { chapters } = await parsed;
    const titled = chapters.filter((ch) => ch.title && ch.title.trim().length > 0);
    expect(titled.length / chapters.length).toBeGreaterThanOrEqual(0.8);
  });

  it('finds known chapter titles', async () => {
    const { chapters } = await parsed;
    const titles = chapters.map((ch) => ch.title);
    expect(titles).toContain('Prologue');
    expect(titles).toContain('Chapter 1');
    expect(titles).toContain('Chapter 60');
  });

  it('skips obvious front matter (copyright, dedication, toc) but keeps real chapters', async () => {
    const { chapters } = await parsed;
    const titles = chapters.map((ch) => ch.title ?? '');
    expect(titles).not.toContain('Copyright');
    expect(titles).not.toContain('Dedication');
    expect(titles).not.toContain('Table of Contents');
  });

  it('extracts the cover image', async () => {
    const { cover } = await parsed;
    expect(cover).toBeDefined();
    expect(cover!.mediaType).toMatch(/^image\//);
    expect(cover!.data.length).toBeGreaterThan(1000);
  });
});

/** Builds a tiny but structurally valid EPUB in memory. */
function buildSyntheticEpub(): Uint8Array {
  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>Tiny Test Book</dc:title>
    <dc:creator>Testy Author</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="bookid" opf:scheme="ISBN">9781234567890</dc:identifier>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover-img" href="images/cover.jpeg" media-type="image/jpeg"/>
    <item id="ch1" href="text/ch%201.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;

  const chapterBody = (n: number, heading: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>ch${n}</title></head>
<body><h1>${heading}</h1><p>${`Sentence ${n} of sufficient length to look like prose. `.repeat(20)}</p></body></html>`;

  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="9781234567890"/></head>
  <docTitle><text>Tiny Test Book</text></docTitle>
  <navMap>
    <navPoint id="n1" playOrder="1"><navLabel><text>Chapter One</text></navLabel><content src="text/ch%201.xhtml"/></navPoint>
    <navPoint id="n2" playOrder="2"><navLabel><text>Chapter Two</text></navLabel><content src="text/ch2.xhtml#frag"/></navPoint>
  </navMap>
</ncx>`;

  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(container),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/toc.ncx': strToU8(ncx),
    'OEBPS/images/cover.jpeg': new Uint8Array(2048).fill(0xab),
    // Note: stored with a literal space; the manifest/ncx reference it URL-encoded.
    'OEBPS/text/ch 1.xhtml': strToU8(chapterBody(1, 'Chapter One')),
    'OEBPS/text/ch2.xhtml': strToU8(chapterBody(2, 'Chapter Two')),
  });
}

describe('parseEpub (synthetic EPUB)', () => {
  it('parses metadata including ISBN', async () => {
    const parsed = await parseEpub(buildSyntheticEpub());
    expect(parsed.metadata).toEqual({
      title: 'Tiny Test Book',
      author: 'Testy Author',
      language: 'en',
      isbn: '9781234567890',
    });
  });

  it('extracts exactly the two chapters in spine order with ncx titles', async () => {
    const parsed = await parseEpub(buildSyntheticEpub());
    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.chapters[0]).toMatchObject({ idx: 0, title: 'Chapter One' });
    expect(parsed.chapters[1]).toMatchObject({ idx: 1, title: 'Chapter Two' });
    expect(parsed.chapters[0]!.html).toContain('<h1>Chapter One</h1>');
    expect(parsed.chapters[0]!.html).toContain('Sentence 1 of sufficient length');
    expect(parsed.chapters[1]!.html).toContain('Sentence 2 of sufficient length');
  });

  it('resolves the cover via <meta name="cover">', async () => {
    const parsed = await parseEpub(buildSyntheticEpub());
    expect(parsed.cover).toBeDefined();
    expect(parsed.cover!.mediaType).toBe('image/jpeg');
    expect(parsed.cover!.data.length).toBe(2048);
  });
});

describe('parseEpub (error cases)', () => {
  it('throws on random bytes that are not a zip', async () => {
    const junk = new Uint8Array(256).map(() => Math.floor(Math.random() * 256));
    await expect(parseEpub(junk)).rejects.toThrow(/zip|epub/i);
  });

  it('throws on a zip without META-INF/container.xml', async () => {
    const zip = zipSync({
      mimetype: strToU8('application/epub+zip'),
      'hello.txt': strToU8('not an epub'),
    });
    await expect(parseEpub(zip)).rejects.toThrow(/container/i);
  });

  it('throws when the OPF referenced by container.xml is missing', async () => {
    const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
    const zip = zipSync({
      mimetype: strToU8('application/epub+zip'),
      'META-INF/container.xml': strToU8(container),
    });
    await expect(parseEpub(zip)).rejects.toThrow(/opf/i);
  });
});

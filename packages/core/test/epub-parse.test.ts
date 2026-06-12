import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { strToU8, zipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';

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
  // Lazy: read + parse only when the suite actually runs (fixture present).
  let parsed: Awaited<ReturnType<typeof parseEpub>>;
  beforeAll(async () => {
    parsed = await parseEpub(readFileSync(FIXTURE_PATH));
  });

  it('extracts metadata', () => {
    const { metadata } = parsed;
    expect(metadata.title).toBe('Assistant to the Villain');
    expect(metadata.author).toContain('Maehrer');
    expect(metadata.language).toBeDefined();
    // This calibre EPUB carries only uuid identifiers — no ISBN.
    expect(metadata.isbn).toBeUndefined();
  });

  it('extracts a sane number of chapters (Prologue + 60 chapters + marginal matter)', () => {
    const { chapters } = parsed;
    expect(chapters.length).toBeGreaterThanOrEqual(58);
    expect(chapters.length).toBeLessThanOrEqual(66);
  });

  it('produces non-empty html and sequential idx from 0', () => {
    parsed.chapters.forEach((ch, i) => {
      expect(ch.idx).toBe(i);
      expect(ch.html.trim().length).toBeGreaterThan(0);
    });
  });

  it('titles at least 80% of chapters from the ncx', () => {
    const { chapters } = parsed;
    const titled = chapters.filter((ch) => ch.title && ch.title.trim().length > 0);
    expect(titled.length / chapters.length).toBeGreaterThanOrEqual(0.8);
  });

  it('finds known chapter titles', () => {
    const titles = parsed.chapters.map((ch) => ch.title);
    expect(titles).toContain('Prologue');
    expect(titles).toContain('Chapter 1');
    expect(titles).toContain('Chapter 60');
  });

  it('skips obvious front matter (copyright, dedication, toc) but keeps real chapters', () => {
    const titles = parsed.chapters.map((ch) => ch.title ?? '');
    expect(titles).not.toContain('Copyright');
    expect(titles).not.toContain('Dedication');
    expect(titles).not.toContain('Table of Contents');
  });

  it('reports skipped documents with paths and reasons', () => {
    expect(parsed.skipped.length).toBeGreaterThan(0);
    const titlepage = parsed.skipped.find((s) => s.path.includes('titlepage'));
    expect(titlepage).toBeDefined();
    expect(titlepage!.reason.length).toBeGreaterThan(0);
  });

  it('extracts the cover image', () => {
    const { cover } = parsed;
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

/** Configurable synthetic EPUB builder for targeted regression tests. */
interface SynthDoc {
  id: string;
  /** href as referenced from the manifest and ncx. */
  href: string;
  /** Actual zip entry name; defaults to `OEBPS/${href}`. */
  zipName?: string;
  /** ncx navLabel; omitted from the navMap when absent. */
  label?: string;
  /** Full file content; defaults to a generic prose chapter. */
  content?: string | Uint8Array;
  linear?: string;
}

function defaultDocContent(id: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${id}</title></head>
<body><h1>Heading ${id}</h1><p>${`Prose for ${id}, long enough to clear the chapter length floor. `.repeat(10)}</p></body></html>`;
}

function buildEpub(docs: SynthDoc[], opts: { creatorsXml?: string } = {}): Uint8Array {
  const creators = opts.creatorsXml ?? '<dc:creator>Testy Author</dc:creator>';
  const manifestItems = docs
    .map((d) => `<item id="${d.id}" href="${d.href}" media-type="application/xhtml+xml"/>`)
    .join('\n    ');
  const spineItems = docs
    .map((d) => `<itemref idref="${d.id}"${d.linear ? ` linear="${d.linear}"` : ''}/>`)
    .join('\n    ');
  const navPoints = docs
    .filter((d) => d.label)
    .map(
      (d, i) =>
        `<navPoint id="np${i}" playOrder="${i + 1}"><navLabel><text>${d.label}</text></navLabel><content src="${d.href}"/></navPoint>`,
    )
    .join('\n    ');

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>Configurable Test Book</dc:title>
    ${creators}
    <dc:language>en</dc:language>
    <dc:identifier id="bookid">urn:uuid:00000000-0000-0000-0000-000000000000</dc:identifier>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${manifestItems}
  </manifest>
  <spine toc="ncx">
    ${spineItems}
  </spine>
</package>`;

  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:00000000-0000-0000-0000-000000000000"/></head>
  <docTitle><text>Configurable Test Book</text></docTitle>
  <navMap>
    ${navPoints}
  </navMap>
</ncx>`;

  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(container),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/toc.ncx': strToU8(ncx),
  };
  for (const d of docs) {
    const content = d.content ?? defaultDocContent(d.id);
    files[d.zipName ?? `OEBPS/${d.href}`] =
      typeof content === 'string' ? strToU8(content) : content;
  }
  return zipSync(files);
}

describe('parseEpub (XHTML quirks)', () => {
  it('retains a chapter whose head has a self-closing <title/> (raw-text swallow bug)', async () => {
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title/></head>
<body><h1>Chapter One</h1><p>${'Real prose follows the empty self-closing title element in the head. '.repeat(8)}</p></body></html>`;
    const parsed = await parseEpub(
      buildEpub([{ id: 'c1', href: 'text/c1.xhtml', label: 'Chapter One', content }]),
    );
    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.chapters[0]!.title).toBe('Chapter One');
    expect(parsed.chapters[0]!.html).toContain('Real prose follows');
  });

  it('throws a descriptive error on UTF-16 encoded entries', async () => {
    const utf16Doc = new Uint8Array(
      Buffer.from('\ufeff' + defaultDocContent('c1'), 'utf16le'),
    );
    await expect(
      parseEpub(buildEpub([{ id: 'c1', href: 'text/c1.xhtml', content: utf16Doc }])),
    ).rejects.toThrow(/utf-16/i);
  });
});

describe('parseEpub (non-chapter filtering)', () => {
  it('keeps chapters whose titles merely start with front-matter words', async () => {
    const parsed = await parseEpub(
      buildEpub([
        { id: 'c1', href: 'text/c1.xhtml', label: 'Cover Story' },
        { id: 'c2', href: 'text/c2.xhtml', label: 'Contents Under Pressure' },
        { id: 'c3', href: 'text/c3.xhtml', label: 'Dedication to Duty' },
        { id: 'c4', href: 'text/c4.xhtml', label: 'Dedication' },
      ]),
    );
    const titles = parsed.chapters.map((c) => c.title);
    expect(titles).toEqual(['Cover Story', 'Contents Under Pressure', 'Dedication to Duty']);
    expect(parsed.skipped).toContainEqual(
      expect.objectContaining({ path: expect.stringContaining('c4.xhtml') }),
    );
  });

  it('keeps files whose names merely contain front-matter substrings', async () => {
    const parsed = await parseEpub(
      buildEpub([
        { id: 'doc1', href: 'text/uncovered.xhtml', label: 'One' },
        { id: 'doc2', href: 'text/navigators-log.xhtml', label: 'Two' },
        { id: 'doc3', href: 'text/cover.xhtml', label: 'Three' },
      ]),
    );
    const titles = parsed.chapters.map((c) => c.title);
    expect(titles).toEqual(['One', 'Two']);
    expect(parsed.skipped).toContainEqual(
      expect.objectContaining({ path: expect.stringContaining('cover.xhtml') }),
    );
  });

  it('skips spine items with linear="no"', async () => {
    const parsed = await parseEpub(
      buildEpub([
        { id: 'c1', href: 'text/c1.xhtml', label: 'One' },
        { id: 'c2', href: 'text/c2.xhtml', label: 'Two', linear: 'no' },
      ]),
    );
    expect(parsed.chapters.map((c) => c.title)).toEqual(['One']);
    const skip = parsed.skipped.find((s) => s.path.includes('c2.xhtml'));
    expect(skip).toBeDefined();
    expect(skip!.reason).toMatch(/linear/i);
  });
});

describe('parseEpub (metadata and entry lookup)', () => {
  it('prefers dc:creator entries with opf:role="aut" and joins multiples', async () => {
    const parsed = await parseEpub(
      buildEpub([{ id: 'c1', href: 'text/c1.xhtml' }], {
        creatorsXml: `<dc:creator opf:role="edt">Eddie Editor</dc:creator>
    <dc:creator opf:role="aut">Alice Author</dc:creator>
    <dc:creator opf:role="aut">Bob Writer</dc:creator>`,
      }),
    );
    expect(parsed.metadata.author).toBe('Alice Author, Bob Writer');
  });

  it('joins all creators when none are marked as authors', async () => {
    const parsed = await parseEpub(
      buildEpub([{ id: 'c1', href: 'text/c1.xhtml' }], {
        creatorsXml: `<dc:creator>First Person</dc:creator>
    <dc:creator>Second Person</dc:creator>`,
      }),
    );
    expect(parsed.metadata.author).toBe('First Person, Second Person');
  });

  it('finds zip entries stored percent-encoded when the href is decoded', async () => {
    const parsed = await parseEpub(
      buildEpub([
        {
          id: 'c1',
          href: 'text/ch 2.xhtml',
          zipName: 'OEBPS/text/ch%202.xhtml',
          label: 'Chapter Two',
        },
      ]),
    );
    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.chapters[0]!.title).toBe('Chapter Two');
  });
});

describe('parseEpub (error cases)', () => {
  it('throws on random bytes that are not a zip', async () => {
    const junk = new Uint8Array(256).map(() => Math.floor(Math.random() * 256));
    await expect(parseEpub(junk)).rejects.toThrow(/zip|epub/i);
  });

  it('wraps zip failures with the original error as cause', async () => {
    const junk = new Uint8Array(256).map(() => Math.floor(Math.random() * 256));
    const err: unknown = await parseEpub(junk).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).cause).toBeDefined();
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

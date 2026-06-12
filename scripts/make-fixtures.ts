/**
 * Fixture extraction script.
 *
 * Usage: pnpm tsx scripts/make-fixtures.ts
 *
 * Finds the first `*.epub` in the repo root (the real test book, gitignored),
 * copies it to packages/core/test/fixtures/book.epub, and extracts three
 * representative chapter XHTML documents (early/middle/late spine items that
 * are actual chapters, picked by text length) to
 * packages/core/test/fixtures/chapter-{early,middle,late}.xhtml for fast
 * iteration. Fixtures are gitignored; re-run this script after cloning.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = join(repoRoot, 'packages/core/test/fixtures');

const epubName = readdirSync(repoRoot).find((f) => f.endsWith('.epub'));
if (!epubName) {
  console.error('No *.epub found in repo root. Place the test book there and re-run.');
  process.exit(1);
}
const epubPath = join(repoRoot, epubName);
console.log(`Found EPUB: ${epubName}`);

mkdirSync(fixturesDir, { recursive: true });
copyFileSync(epubPath, join(fixturesDir, 'book.epub'));
console.log('Copied -> packages/core/test/fixtures/book.epub');

// Minimal spine walk (the real parser lives in packages/core/src/epub/parse.ts;
// this script only needs enough to pick three chapter-sized documents).
const zip = unzipSync(new Uint8Array(readFileSync(epubPath)));
const entry = (path: string) => {
  const found = zip[path] ?? zip[decodeURIComponent(path)];
  if (!found) throw new Error(`Missing zip entry: ${path}`);
  return found;
};

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
const container = xml.parse(strFromU8(entry('META-INF/container.xml')));
const rootfiles = container.container.rootfiles.rootfile;
const opfPath: string = (Array.isArray(rootfiles) ? rootfiles[0] : rootfiles)['@_full-path'];
const opfDir = posix.dirname(opfPath);

const opf = xml.parse(strFromU8(entry(opfPath)));
const items = [opf.package.manifest.item].flat();
const manifest = new Map<string, { href: string; mediaType: string }>(
  items.map((i: any) => [i['@_id'], { href: i['@_href'], mediaType: i['@_media-type'] }]),
);
const spine = [opf.package.spine.itemref].flat().map((r: any) => r['@_idref']);

const resolve = (href: string) =>
  opfDir === '.' ? href : posix.normalize(posix.join(opfDir, href));

const textLength = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;

const chapterDocs = spine
  .map((idref: string) => manifest.get(idref))
  .filter((item): item is { href: string; mediaType: string } => !!item)
  .map((item) => ({ href: resolve(item.href), html: strFromU8(entry(resolve(item.href))) }))
  .filter((doc) => textLength(doc.html) >= 5000); // real chapters only

if (chapterDocs.length < 3) {
  console.error(`Only found ${chapterDocs.length} chapter-sized spine docs; need 3.`);
  process.exit(1);
}

const picks = {
  early: chapterDocs[0]!,
  middle: chapterDocs[Math.floor(chapterDocs.length / 2)]!,
  late: chapterDocs[chapterDocs.length - 1]!,
};
for (const [name, doc] of Object.entries(picks)) {
  writeFileSync(join(fixturesDir, `chapter-${name}.xhtml`), doc.html);
  console.log(`Extracted ${doc.href} -> chapter-${name}.xhtml (${textLength(doc.html)} text chars)`);
}
console.log('Done.');

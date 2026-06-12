import { Buffer } from 'node:buffer';
import { posix } from 'node:path';

import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { strFromU8, unzipSync, type Unzipped } from 'fflate';

export interface ParsedEpub {
  metadata: { title: string; author?: string; language?: string; isbn?: string };
  cover?: { data: Buffer; mediaType: string };
  chapters: Array<{ idx: number; title?: string; html: string }>;
}

interface ManifestItem {
  href: string;
  mediaType: string;
  properties: string[];
}

/** fast-xml-parser configured for EPUB XML: keep attributes, drop ns prefixes. */
const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
});

/** Normalizes a fast-xml-parser node (string | number | {#text}) to a string. */
function textOf(node: unknown): string | undefined {
  if (node == null) return undefined;
  if (typeof node === 'string' || typeof node === 'number') return String(node).trim() || undefined;
  if (typeof node === 'object' && '#text' in (node as Record<string, unknown>)) {
    return textOf((node as Record<string, unknown>)['#text']);
  }
  return undefined;
}

/** Always returns an array, whether fast-xml-parser produced one node or many. */
function asArray<T>(node: T | T[] | undefined): T[] {
  if (node == null) return [];
  return Array.isArray(node) ? node : [node];
}

/** Tolerant zip entry lookup: tries the path as-is and URL-decoded. */
function getEntry(zip: Unzipped, path: string): Uint8Array | undefined {
  if (zip[path]) return zip[path];
  try {
    const decoded = decodeURIComponent(path);
    if (zip[decoded]) return zip[decoded];
  } catch {
    // Malformed percent-encoding; fall through.
  }
  return undefined;
}

/** Resolves an href relative to a base directory inside the zip. */
function resolveHref(baseDir: string, href: string): string {
  const clean = href.split('#')[0]!;
  return posix.normalize(baseDir === '.' ? clean : posix.join(baseDir, clean));
}

/** Strips markup and collapses whitespace to measure real text content. */
function plainTextLength(text: string): number {
  return text.replace(/\s+/g, ' ').trim().length;
}

/** ncx labels / guide types that indicate non-chapter documents. */
const NON_CHAPTER_LABEL =
  /^(cover|title\s*page|half\s*title|table of contents|contents|copyright|dedication|acknowledg|about the author|also by|praise for|epigraph|colophon)/i;

/** Filename/id hints for non-chapter documents. */
const NON_CHAPTER_NAME = /cover|toc|nav|title-?page|copyright|front-?matter|half-?title/i;

/** Guide reference types that indicate non-chapter documents. */
const NON_CHAPTER_GUIDE_TYPE =
  /toc|cover|title-?page|copyright|dedication|acknowledg|colophon|index/i;

const MIN_CHAPTER_TEXT_CHARS = 200;

export async function parseEpub(buf: Buffer | Uint8Array): Promise<ParsedEpub> {
  let zip: Unzipped;
  try {
    zip = unzipSync(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  } catch (err) {
    throw new Error(`Not a valid EPUB: failed to read zip archive (${(err as Error).message})`);
  }

  // 1. container.xml -> OPF path
  const containerBytes = getEntry(zip, 'META-INF/container.xml');
  if (!containerBytes) {
    throw new Error('Not a valid EPUB: missing META-INF/container.xml');
  }
  const container = xml.parse(strFromU8(containerBytes));
  const rootfile = asArray(container?.container?.rootfiles?.rootfile)[0];
  const opfPath: string | undefined = rootfile?.['@_full-path'];
  if (!opfPath) {
    throw new Error('Not a valid EPUB: container.xml has no rootfile full-path');
  }

  // 2. OPF -> metadata / manifest / spine / guide
  const opfBytes = getEntry(zip, opfPath);
  if (!opfBytes) {
    throw new Error(`Not a valid EPUB: OPF file "${opfPath}" not found in archive`);
  }
  const opfDir = posix.dirname(opfPath);
  const opf = xml.parse(strFromU8(opfBytes));
  const pkg = opf?.package;
  if (!pkg?.manifest || !pkg?.spine) {
    throw new Error(`Not a valid EPUB: OPF "${opfPath}" is missing manifest or spine`);
  }

  const meta = pkg.metadata ?? {};
  const title = textOf(asArray(meta.title)[0]) ?? 'Untitled';
  const author = textOf(asArray(meta.creator)[0]);
  const language = textOf(asArray(meta.language)[0]);
  const isbn = extractIsbn(asArray(meta.identifier));

  const manifest = new Map<string, ManifestItem>();
  for (const item of asArray<any>(pkg.manifest.item)) {
    const id = item['@_id'];
    const href = item['@_href'];
    if (!id || !href) continue;
    manifest.set(id, {
      href,
      mediaType: item['@_media-type'] ?? '',
      properties: String(item['@_properties'] ?? '')
        .split(/\s+/)
        .filter(Boolean),
    });
  }

  const spineIdrefs = asArray<any>(pkg.spine.itemref)
    .map((r) => r['@_idref'] as string | undefined)
    .filter((id): id is string => !!id);

  // 3. Cover
  const cover = extractCover(zip, manifest, asArray<any>(meta.meta), opfDir);

  // 4. Title sources: ncx navMap and/or EPUB3 nav doc -> path -> label
  const titleByPath = new Map<string, string>();
  collectNcxTitles(zip, manifest, opfDir, titleByPath);
  collectNavDocTitles(zip, manifest, opfDir, titleByPath);

  // 5. Guide-based skip hints (EPUB2 <guide>)
  const skipPaths = new Set<string>();
  for (const ref of asArray<any>(pkg.guide?.reference)) {
    const type = String(ref?.['@_type'] ?? '');
    const href = ref?.['@_href'];
    if (href && NON_CHAPTER_GUIDE_TYPE.test(type)) {
      skipPaths.add(resolveHref(opfDir, String(href)));
    }
  }

  // 6. Walk the spine, filter non-content docs, extract chapter html + title
  const chapters: ParsedEpub['chapters'] = [];
  for (const idref of spineIdrefs) {
    const item = manifest.get(idref);
    if (!item) continue;
    if (!/x?html/i.test(item.mediaType)) continue;
    if (item.properties.includes('nav')) continue;

    const path = resolveHref(opfDir, item.href);
    const basename = posix.basename(path);
    if (skipPaths.has(path)) continue;
    if (NON_CHAPTER_NAME.test(basename) || NON_CHAPTER_NAME.test(idref)) continue;

    const label = titleByPath.get(path);
    if (label && NON_CHAPTER_LABEL.test(label)) continue;

    const bytes = getEntry(zip, path);
    if (!bytes) continue;

    const $ = cheerio.load(strFromU8(bytes));
    const body = $('body');
    if (plainTextLength(body.text()) < MIN_CHAPTER_TEXT_CHARS) continue;

    const html = body.html() ?? '';
    if (!html.trim()) continue;

    const headingTitle = body.find('h1, h2, h3').first().text().replace(/\s+/g, ' ').trim();
    chapters.push({
      idx: chapters.length,
      title: label ?? (headingTitle || undefined),
      html,
    });
  }

  return { metadata: { title, author, language, isbn }, cover, chapters };
}

/** Finds an ISBN among dc:identifier elements (scheme attr or urn:isbn value). */
function extractIsbn(identifiers: unknown[]): string | undefined {
  for (const id of identifiers) {
    const value = textOf(id);
    if (!value) continue;
    const scheme = String((id as Record<string, unknown>)?.['@_scheme'] ?? '');
    if (/isbn/i.test(scheme)) return value.replace(/^urn:isbn:/i, '');
    if (/^urn:isbn:/i.test(value)) return value.replace(/^urn:isbn:/i, '');
  }
  return undefined;
}

/** Cover: manifest properties 'cover-image' first, then <meta name="cover" content="id">. */
function extractCover(
  zip: Unzipped,
  manifest: Map<string, ManifestItem>,
  metas: any[],
  opfDir: string,
): ParsedEpub['cover'] {
  let item: ManifestItem | undefined;
  for (const candidate of manifest.values()) {
    if (candidate.properties.includes('cover-image')) {
      item = candidate;
      break;
    }
  }
  if (!item) {
    const coverMeta = metas.find((m) => m?.['@_name'] === 'cover');
    const coverId = coverMeta?.['@_content'];
    if (coverId) item = manifest.get(String(coverId));
  }
  if (!item) return undefined;

  const bytes = getEntry(zip, resolveHref(opfDir, item.href));
  if (!bytes) return undefined;
  return { data: Buffer.from(bytes), mediaType: item.mediaType || 'image/jpeg' };
}

/** Reads toc.ncx (EPUB2) navMap into path -> label (first label per path wins). */
function collectNcxTitles(
  zip: Unzipped,
  manifest: Map<string, ManifestItem>,
  opfDir: string,
  out: Map<string, string>,
): void {
  const ncxItem = [...manifest.values()].find((i) => /dtbncx/i.test(i.mediaType));
  if (!ncxItem) return;
  const ncxPath = resolveHref(opfDir, ncxItem.href);
  const bytes = getEntry(zip, ncxPath);
  if (!bytes) return;

  const ncxDir = posix.dirname(ncxPath);
  const ncx = xml.parse(strFromU8(bytes));

  const walk = (points: unknown): void => {
    for (const point of asArray<any>(points)) {
      const label = textOf(point?.navLabel?.text);
      const src = point?.content?.['@_src'];
      if (label && src) {
        const path = resolveHref(ncxDir, String(src));
        if (!out.has(path)) out.set(path, label);
      }
      if (point?.navPoint) walk(point.navPoint);
    }
  };
  walk(ncx?.ncx?.navMap?.navPoint);
}

/** Reads the EPUB3 nav document's toc anchors into path -> label. */
function collectNavDocTitles(
  zip: Unzipped,
  manifest: Map<string, ManifestItem>,
  opfDir: string,
  out: Map<string, string>,
): void {
  const navItem = [...manifest.values()].find((i) => i.properties.includes('nav'));
  if (!navItem) return;
  const navPath = resolveHref(opfDir, navItem.href);
  const bytes = getEntry(zip, navPath);
  if (!bytes) return;

  const navDir = posix.dirname(navPath);
  const $ = cheerio.load(strFromU8(bytes));
  const toc = $('nav[epub\\:type="toc"], nav[role="doc-toc"]');
  const scope = toc.length ? toc : $('nav').first();
  scope.find('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const label = $(el).text().replace(/\s+/g, ' ').trim();
    if (!href || !label) return;
    const path = resolveHref(navDir, href);
    if (!out.has(path)) out.set(path, label);
  });
}

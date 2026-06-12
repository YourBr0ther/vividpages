import { Buffer } from 'node:buffer';
import { posix } from 'node:path';

import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { strFromU8, unzipSync, type Unzipped } from 'fflate';

export interface ParsedEpub {
  metadata: { title: string; author?: string; language?: string; isbn?: string };
  cover?: { data: Buffer; mediaType: string };
  chapters: Array<{ idx: number; title?: string; html: string }>;
  /** Spine documents that were filtered out, with the reason, for ingest logging. */
  skipped: Array<{ path: string; reason: string }>;
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

/** Tolerant zip entry lookup: tries the path as-is, URL-decoded, and URL-encoded. */
function getEntry(zip: Unzipped, path: string): Uint8Array | undefined {
  for (const candidate of entryNameCandidates(path)) {
    if (zip[candidate]) return zip[candidate];
  }
  return undefined;
}

/** All zip entry names a manifest href might be stored under. */
function entryNameCandidates(path: string): string[] {
  const candidates = [path];
  try {
    const decoded = decodeURIComponent(path);
    if (decoded !== path) candidates.push(decoded);
  } catch {
    // Malformed percent-encoding; skip the decoded variant.
  }
  const encoded = encodeURI(path);
  if (encoded !== path) candidates.push(encoded);
  return candidates;
}

/**
 * Decodes a zip entry as UTF-8 text, rejecting UTF-16 content outright —
 * decoding it as UTF-8 would silently produce mojibake.
 */
function decodeText(bytes: Uint8Array, path: string): string {
  if (
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
  ) {
    throw new Error(
      `Unsupported encoding in EPUB entry "${path}": UTF-16 BOM detected; only UTF-8 is supported`,
    );
  }
  return strFromU8(bytes);
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

/**
 * ncx labels / guide types that indicate non-chapter documents.
 * Anchored at both ends so real chapters like "Cover Story" or
 * "Dedication to Duty" are not swept up; "also by"/"praise for" pages
 * intentionally allow a trailing author/book name.
 */
const NON_CHAPTER_LABEL =
  /^(cover|title\s*page|half\s*title|table of contents|contents|copyright( page)?|dedication|acknowledge?ments?|about the author|epigraph|colophon|also by\b.*|praise for\b.*)\s*$/i;

/**
 * Filename/id hints for non-chapter documents. Word-boundary-ish so
 * "uncovered.xhtml" or "navigators-log.xhtml" are not false positives.
 */
const NON_CHAPTER_NAME =
  /(^|[^a-z])(cover|toc|nav|title-?page|copyright|front-?matter|half-?title)([^a-z]|$)/i;

/** Guide reference types that indicate non-chapter documents. */
const NON_CHAPTER_GUIDE_TYPE =
  /toc|cover|title-?page|copyright|dedication|acknowledg|colophon|index/i;

const MIN_CHAPTER_TEXT_CHARS = 200;

/** Zip entry names worth inflating up front: package/toc XML and content documents. */
function isTextEntry(name: string): boolean {
  return /\.(x?html?|xml|ncx|opf)$/i.test(name) || name.startsWith('META-INF/');
}

export async function parseEpub(buf: Buffer | Uint8Array): Promise<ParsedEpub> {
  const data = buf instanceof Uint8Array ? buf : new Uint8Array(buf);

  // First unzip pass: inflate only text-ish entries (XML/XHTML/ncx/opf/container).
  // Images and fonts stay compressed; the cover is inflated in a targeted second pass.
  let zip: Unzipped;
  try {
    zip = unzipSync(data, { filter: (file) => isTextEntry(file.name) });
  } catch (err) {
    throw new Error(`Not a valid EPUB: failed to read zip archive (${(err as Error).message})`, {
      cause: err,
    });
  }

  // 1. container.xml -> OPF path
  const containerBytes = getEntry(zip, 'META-INF/container.xml');
  if (!containerBytes) {
    throw new Error('Not a valid EPUB: missing META-INF/container.xml');
  }
  const container = xml.parse(decodeText(containerBytes, 'META-INF/container.xml'));
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
  const opf = xml.parse(decodeText(opfBytes, opfPath));
  const pkg = opf?.package;
  if (!pkg?.manifest || !pkg?.spine) {
    throw new Error(`Not a valid EPUB: OPF "${opfPath}" is missing manifest or spine`);
  }

  const meta = pkg.metadata ?? {};
  const title = textOf(asArray(meta.title)[0]) ?? 'Untitled';
  const author = extractAuthor(asArray(meta.creator));
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

  // 3. Cover (second targeted unzip pass for just the cover image)
  const cover = extractCover(data, manifest, asArray<any>(meta.meta), opfDir);

  // 4. Title sources: ncx navMap and/or EPUB3 nav doc -> path -> label
  const titleByPath = new Map<string, string>();
  collectNcxTitles(zip, manifest, opfDir, titleByPath);
  collectNavDocTitles(zip, manifest, opfDir, titleByPath);

  // 5. Guide-based skip hints (EPUB2 <guide>)
  const guideSkips = new Map<string, string>();
  for (const ref of asArray<any>(pkg.guide?.reference)) {
    const type = String(ref?.['@_type'] ?? '');
    const href = ref?.['@_href'];
    if (href && NON_CHAPTER_GUIDE_TYPE.test(type)) {
      guideSkips.set(resolveHref(opfDir, String(href)), type);
    }
  }

  // 6. Walk the spine, filter non-content docs, extract chapter html + title
  const chapters: ParsedEpub['chapters'] = [];
  const skipped: ParsedEpub['skipped'] = [];
  for (const itemref of asArray<any>(pkg.spine.itemref)) {
    const idref = itemref?.['@_idref'] as string | undefined;
    if (!idref) continue;
    const item = manifest.get(idref);
    const path = item ? resolveHref(opfDir, item.href) : idref;

    if (String(itemref?.['@_linear'] ?? '').toLowerCase() === 'no') {
      skipped.push({ path, reason: 'spine itemref has linear="no"' });
      continue;
    }
    if (!item) {
      skipped.push({ path, reason: `spine idref "${idref}" not found in manifest` });
      continue;
    }
    if (!/x?html/i.test(item.mediaType)) continue;
    if (item.properties.includes('nav')) {
      skipped.push({ path, reason: 'EPUB3 nav document' });
      continue;
    }

    const basename = posix.basename(path);
    const guideType = guideSkips.get(path);
    if (guideType) {
      skipped.push({ path, reason: `guide reference type "${guideType}"` });
      continue;
    }
    if (NON_CHAPTER_NAME.test(basename) || NON_CHAPTER_NAME.test(idref)) {
      skipped.push({ path, reason: 'filename/id hints non-chapter document' });
      continue;
    }

    const label = titleByPath.get(path);
    if (label && NON_CHAPTER_LABEL.test(label)) {
      skipped.push({ path, reason: `toc label "${label}" hints non-chapter document` });
      continue;
    }

    const bytes = getEntry(zip, path);
    if (!bytes) {
      skipped.push({ path, reason: 'entry missing from zip archive' });
      continue;
    }

    const src = decodeText(bytes, path);
    let $ = cheerio.load(src);
    let body = $('body');
    if (!body.length || plainTextLength(body.text()) === 0) {
      // HTML-mode parsing destroys XHTML with self-closing raw-text elements
      // (<title/>, <script/>, <style/> swallow the rest of the document).
      // Retry in XML mode; HTML mode stays primary because XML mode chokes
      // on undeclared entities like &nbsp;.
      try {
        const $xml = cheerio.load(src, { xml: true });
        const xmlBody = $xml('body');
        if (xmlBody.length) {
          $ = $xml;
          body = xmlBody;
        }
      } catch {
        // Keep the HTML-mode result; the length floor below decides.
      }
    }
    if (plainTextLength(body.text()) < MIN_CHAPTER_TEXT_CHARS) {
      skipped.push({
        path,
        reason: `text shorter than ${MIN_CHAPTER_TEXT_CHARS} chars`,
      });
      continue;
    }

    const html = body.html() ?? '';
    if (!html.trim()) {
      skipped.push({ path, reason: 'empty body markup' });
      continue;
    }

    const headingTitle = body.find('h1, h2, h3').first().text().replace(/\s+/g, ' ').trim();
    chapters.push({
      idx: chapters.length,
      title: label ?? (headingTitle || undefined),
      html,
    });
  }

  return { metadata: { title, author, language, isbn }, cover, chapters, skipped };
}

/** Joins dc:creator entries, preferring those marked opf:role="aut" when present. */
function extractAuthor(creators: unknown[]): string | undefined {
  const authors = creators.filter((c) =>
    /^aut$/i.test(String((c as Record<string, unknown>)?.['@_role'] ?? '')),
  );
  const names = (authors.length ? authors : creators)
    .map(textOf)
    .filter((name): name is string => !!name);
  return names.length ? names.join(', ') : undefined;
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

/**
 * Cover: manifest properties 'cover-image' first, then <meta name="cover" content="id">.
 * Inflates only the cover entry from the raw archive (it was excluded from the
 * text-only first pass to avoid inflating every image in the book).
 */
function extractCover(
  data: Uint8Array,
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

  const coverPath = resolveHref(opfDir, item.href);
  const wanted = new Set(entryNameCandidates(coverPath));
  let coverZip: Unzipped;
  try {
    coverZip = unzipSync(data, { filter: (file) => wanted.has(file.name) });
  } catch {
    return undefined;
  }
  const bytes = getEntry(coverZip, coverPath);
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
  const ncx = xml.parse(decodeText(bytes, ncxPath));

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
  const $ = cheerio.load(decodeText(bytes, navPath));
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

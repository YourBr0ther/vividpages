/**
 * Serializable shapes shared by the content API, the reader server shell, and
 * the client Reader. Chapter text is intentionally separate from the chapter
 * index so the initial payload stays small (one chapter, not the whole book).
 */

/** A scene's position within its chapter (offsets into the chapter text). */
export interface SceneRef {
  globalIdx: number;
  idx: number;
  startOffset: number;
  endOffset: number;
}

/**
 * One paragraph of a scene: its text and its absolute start offset into the
 * chapter text. The offset lets the Reader match an illustration point's
 * `charOffset` to the paragraph boundary it should sit before.
 */
export interface ScenePara {
  text: string;
  start: number;
}

/** A scene ready to render: its span plus its split paragraphs. */
export type ChapterScene = SceneRef & { paragraphs: ScenePara[] };

/**
 * The latest finished storyboard for one illustration point, placed by its
 * absolute `charOffset` into the chapter text. `subjectId` is the point id —
 * the version/regenerate APIs key on it.
 */
export interface ChapterIllustration {
  imageId: string;
  subjectId: string;
  charOffset: number;
  width: number | null;
  height: number | null;
  version: number;
}

/** One entry in the book's table of contents. */
export interface ChapterMeta {
  idx: number;
  title: string | null;
  wordCount: number | null;
  sceneCount: number;
}

/**
 * A chapter ready to render: full text, its scenes (spans + split paragraphs),
 * and the chapter's illustration points (ordered by charOffset) that the Reader
 * threads through the flowing prose.
 */
export interface ChapterPayload {
  idx: number;
  title: string | null;
  text: string;
  scenes: ChapterScene[];
  illustrationPoints: ChapterIllustration[];
}

/** Display title for a chapter, falling back to its 1-based number. */
export function chapterLabel(chapter: { idx: number; title: string | null }): string {
  return chapter.title?.trim() || `Chapter ${chapter.idx + 1}`;
}

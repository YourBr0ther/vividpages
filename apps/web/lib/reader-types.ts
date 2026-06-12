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

/** One entry in the book's table of contents. */
export interface ChapterMeta {
  idx: number;
  title: string | null;
  wordCount: number | null;
  sceneCount: number;
}

/** A chapter ready to render: full text plus its scene spans. */
export interface ChapterPayload {
  idx: number;
  title: string | null;
  text: string;
  scenes: SceneRef[];
}

/** Display title for a chapter, falling back to its 1-based number. */
export function chapterLabel(chapter: { idx: number; title: string | null }): string {
  return chapter.title?.trim() || `Chapter ${chapter.idx + 1}`;
}

import { memo, useEffect, useRef, useState } from 'react';

import type { ChapterIllustration, ScenePara } from '@/lib/reader-types';

/**
 * An illustration plate: a breakout image wider than the prose column, with its
 * aspect ratio reserved from the stored dimensions (no layout shift),
 * lazy-loaded, and revealed with a quiet fade-and-rise once it scrolls into
 * view (reduced motion: it simply appears). Clicking opens the lightbox.
 */
function SceneArt({
  illustration,
  onOpen,
}: {
  illustration: ChapterIllustration;
  onOpen: () => void;
}) {
  const figureRef = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const figure = figureRef.current;
    if (!figure) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '120px 0px' },
    );
    observer.observe(figure);
    return () => observer.disconnect();
  }, []);

  return (
    <figure
      ref={figureRef}
      className="reader-art"
      data-revealed={inView && loaded}
      style={
        illustration.width && illustration.height
          ? { aspectRatio: `${illustration.width} / ${illustration.height}` }
          : undefined
      }
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label="View illustration"
        className="block h-full w-full cursor-zoom-in"
      >
        {/* Plain <img>: illustrations are private, per-user streamed objects. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/images/${illustration.imageId}`}
          alt="Illustration"
          width={illustration.width ?? undefined}
          height={illustration.height ?? undefined}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className="h-full w-full object-cover"
        />
      </button>
    </figure>
  );
}

/**
 * One scene of a chapter: a quiet ✳ ornament separating it from the previous
 * scene, then its paragraphs with each illustration plate threaded in at its
 * point's `charOffset` — placed before the first paragraph whose absolute start
 * is at or after the offset (the nearest boundary; charOffset is already a
 * paragraph start, so it normally lands exactly there). A point past the last
 * paragraph trails after it. Memoized so chrome show/hide re-renders never
 * reconcile the book text (callers must pass a stable `onIllustrationOpen` plus
 * a stable `points` array).
 */
export const SceneBlock = memo(function SceneBlock({
  globalIdx,
  paragraphs,
  isFirstInChapter,
  points,
  onIllustrationOpen,
}: {
  globalIdx: number;
  paragraphs: ScenePara[];
  isFirstInChapter: boolean;
  /** The chapter's illustration points whose charOffset falls in this scene. */
  points: ChapterIllustration[];
  onIllustrationOpen: (illustration: ChapterIllustration) => void;
}) {
  return (
    <>
      {!isFirstInChapter ? (
        <div aria-hidden className="reader-scenebreak">
          ✳
        </div>
      ) : null}
      <section data-scene={globalIdx} aria-label={`Scene ${globalIdx + 1}`} className="scroll-mt-20">
        {interleave(paragraphs, points).map((node, i) =>
          node.kind === 'para' ? (
            <p key={`p${i}`} className={isFirstInChapter && node.firstInChapter ? 'reader-dropcap' : undefined}>
              {node.text}
            </p>
          ) : (
            <SceneArt
              key={node.point.subjectId}
              illustration={node.point}
              onOpen={() => onIllustrationOpen(node.point)}
            />
          ),
        )}
      </section>
    </>
  );
});

type RenderNode =
  | { kind: 'para'; text: string; firstInChapter: boolean }
  | { kind: 'plate'; point: ChapterIllustration };

/**
 * Thread the scene's illustration plates through its paragraphs by absolute
 * offset: each plate is emitted before the first paragraph whose start is at or
 * after the plate's `charOffset`. Because `charOffset` is already a
 * paragraph-start offset it normally lands exactly on a boundary; an offset
 * between boundaries snaps to the next paragraph, and any plate past the last
 * paragraph trails at the scene's end. Both inputs arrive sorted, so this is a
 * single linear merge — never a mid-paragraph split.
 */
function interleave(paragraphs: ScenePara[], points: ChapterIllustration[]): RenderNode[] {
  const nodes: RenderNode[] = [];
  let p = 0;
  paragraphs.forEach((para, i) => {
    while (p < points.length && points[p]!.charOffset <= para.start) {
      nodes.push({ kind: 'plate', point: points[p]! });
      p += 1;
    }
    nodes.push({ kind: 'para', text: para.text, firstInChapter: i === 0 });
  });
  for (; p < points.length; p += 1) nodes.push({ kind: 'plate', point: points[p]! });
  return nodes;
}

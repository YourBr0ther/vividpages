import { memo, useEffect, useRef, useState } from 'react';

import type { SceneImageRef } from '@/lib/reader-types';

/**
 * The scene's storyboard panel: a breakout plate wider than the prose column,
 * with its aspect ratio reserved from the stored dimensions (no layout shift),
 * lazy-loaded, and revealed with a quiet fade-and-rise once it scrolls into
 * view (reduced motion: it simply appears). Clicking opens the lightbox.
 */
function SceneArt({
  image,
  sceneNumber,
  onOpen,
}: {
  image: SceneImageRef;
  sceneNumber: number;
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
        image.width && image.height
          ? { aspectRatio: `${image.width} / ${image.height}` }
          : undefined
      }
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`View illustration for scene ${sceneNumber}`}
        className="block h-full w-full cursor-zoom-in"
      >
        {/* Plain <img>: illustrations are private, per-user streamed objects. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/images/${image.id}`}
          alt={`Illustration for scene ${sceneNumber}`}
          width={image.width ?? undefined}
          height={image.height ?? undefined}
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
 * scene, the scene's storyboard plate when one has been painted, then its
 * paragraphs. Memoized so chrome show/hide re-renders never reconcile the
 * book text (callers must pass a stable `onImageOpen`).
 */
export const SceneBlock = memo(function SceneBlock({
  globalIdx,
  paragraphs,
  isFirstInChapter,
  image,
  onImageOpen,
}: {
  globalIdx: number;
  paragraphs: string[];
  isFirstInChapter: boolean;
  /** The scene's latest finished storyboard, or null for no art (yet). */
  image: SceneImageRef | null;
  onImageOpen: (image: SceneImageRef, globalIdx: number) => void;
}) {
  return (
    <>
      {!isFirstInChapter ? (
        <div aria-hidden className="reader-scenebreak">
          ✳
        </div>
      ) : null}
      <section data-scene={globalIdx} aria-label={`Scene ${globalIdx + 1}`} className="scroll-mt-20">
        {image ? (
          <SceneArt
            image={image}
            sceneNumber={globalIdx + 1}
            onOpen={() => onImageOpen(image, globalIdx)}
          />
        ) : null}
        {paragraphs.map((text, i) => (
          <p key={i} className={isFirstInChapter && i === 0 ? 'reader-dropcap' : undefined}>
            {text}
          </p>
        ))}
      </section>
    </>
  );
});

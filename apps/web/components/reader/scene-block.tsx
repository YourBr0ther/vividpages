import { memo } from 'react';

/**
 * Empty illustration panel rendered between scenes. M5's imagine stage fills
 * these with generated art; until then the Reader keeps `showImageSlots` off
 * so the text reads clean.
 */
function IllustrationSlot() {
  return (
    <figure
      aria-hidden
      className="my-10 flex aspect-[21/9] w-full items-center justify-center rounded-md border border-dashed"
      style={{ borderColor: 'var(--reader-border)' }}
    >
      <figcaption
        className="text-[11px] font-sans uppercase tracking-[0.3em]"
        style={{ color: 'var(--reader-muted)' }}
      >
        Illustration coming soon
      </figcaption>
    </figure>
  );
}

/**
 * One scene of a chapter: a quiet ✳ ornament separating it from the previous
 * scene (plus the future illustration slot), then its paragraphs. Memoized so
 * chrome show/hide re-renders never reconcile the book text.
 */
export const SceneBlock = memo(function SceneBlock({
  globalIdx,
  paragraphs,
  isFirstInChapter,
  showImageSlot,
}: {
  globalIdx: number;
  paragraphs: string[];
  isFirstInChapter: boolean;
  showImageSlot: boolean;
}) {
  return (
    <>
      {!isFirstInChapter ? (
        <div aria-hidden className="reader-scenebreak">
          ✳
        </div>
      ) : null}
      {!isFirstInChapter && showImageSlot ? <IllustrationSlot /> : null}
      <section data-scene={globalIdx} aria-label={`Scene ${globalIdx + 1}`} className="scroll-mt-20">
        {paragraphs.map((text, i) => (
          <p key={i} className={isFirstInChapter && i === 0 ? 'reader-dropcap' : undefined}>
            {text}
          </p>
        ))}
      </section>
    </>
  );
});

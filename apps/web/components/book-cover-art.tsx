/**
 * Shared physical-book cover treatments, used by the Bookcase cards and the
 * book detail hero. No hooks, so both server and client components can
 * render these.
 */

/**
 * Duotone "cloth binding" palettes for books without a cover image; picked
 * deterministically from the title so a book keeps its binding color.
 */
const BINDINGS = [
  ['#3a2c1e', '#191310'], // umber
  ['#22302a', '#101713'], // forest
  ['#2b2638', '#141119'], // ink violet
  ['#39201f', '#171010'], // oxblood
  ['#1f2a38', '#0f141b'], // midnight
] as const;

function bindingFor(title: string): (typeof BINDINGS)[number] {
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) hash = (hash * 31 + title.charCodeAt(i)) | 0;
  return BINDINGS[Math.abs(hash) % BINDINGS.length] as (typeof BINDINGS)[number];
}

/** Spine shadow + edge highlight layered over the cover face. */
export function SpineOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-[3px]"
      style={{
        background:
          'linear-gradient(90deg, rgba(0,0,0,0.5), rgba(0,0,0,0.12) 7%, rgba(255,255,255,0.07) 9.5%, rgba(0,0,0,0) 13%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(0,0,0,0.4)',
      }}
    />
  );
}

/** Cover face for books without an image: a cloth binding with stamped type. */
export function FallbackCover({ title, author }: { title: string; author: string | null }) {
  const [from, to] = bindingFor(title);
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-between px-4 py-5 text-center"
      style={{ background: `linear-gradient(160deg, ${from}, ${to})` }}
    >
      <div aria-hidden className="w-10 border-t border-b border-parchment/40 py-px">
        <div className="border-t border-b border-parchment/40 py-1" />
      </div>
      <span className="line-clamp-5 font-display text-base leading-snug text-parchment/90">
        {title}
      </span>
      <span className="line-clamp-1 text-[10px] uppercase tracking-[0.25em] text-parchment/50">
        {author ?? 'Unknown'}
      </span>
    </div>
  );
}

import Link from 'next/link';

import type { CastMember } from '@/lib/queries';

import { bindingFor } from './book-cover-art';

/** Overlapping monogram avatar; portraits replace the monogram in M5. */
function MiniAvatar({ member }: { member: CastMember }) {
  const [from, to] = bindingFor(member.name);
  const monogram = [...member.name.trim()][0]?.toUpperCase() ?? '?';
  return (
    <li
      className="relative -ml-2.5 first:ml-0"
      title={`${member.name} · ${member.sceneCount} scene${member.sceneCount === 1 ? '' : 's'}`}
    >
      <span
        className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full ring-2 ring-stone-950"
        style={{ background: `radial-gradient(120% 90% at 50% 25%, ${from}, ${to})` }}
      >
        {member.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={member.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span aria-hidden className="font-display text-lg text-parchment/75">
            {monogram}
          </span>
        )}
        <span className="sr-only">{member.name}</span>
      </span>
    </li>
  );
}

/**
 * Detail-page teaser for the cast gallery: the five most-seen characters as
 * overlapping avatars plus the way into /books/[id]/cast. Render only when
 * the cast is non-empty.
 */
export function CastStrip({
  bookId,
  cast,
  total,
}: {
  bookId: string;
  /** Top members by sceneCount (already sliced by the caller). */
  cast: CastMember[];
  total: number;
}) {
  return (
    <section
      aria-label="The cast"
      className="rounded-xl border border-stone-800/70 bg-stone-900/40 p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg tracking-tight text-parchment">The cast</h2>
        <span className="shrink-0 text-xs tabular-nums text-stone-600">{total}</span>
      </div>
      <ul className="mt-3 flex items-center">
        {cast.map((member) => (
          <MiniAvatar key={member.id} member={member} />
        ))}
        {total > cast.length ? (
          <li aria-hidden className="-ml-2.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-stone-700 bg-stone-900 text-[11px] font-medium text-stone-500 ring-2 ring-stone-950">
              +{total - cast.length}
            </span>
          </li>
        ) : null}
      </ul>
      <p className="mt-2 line-clamp-1 text-xs text-stone-500">
        {cast.map((member) => member.name).join(', ')}
      </p>
      <Link
        href={`/books/${bookId}/cast`}
        className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-ember-400 transition hover:text-ember-300 focus-visible:ring-2 focus-visible:ring-ember-400/70"
      >
        View cast <span aria-hidden>→</span>
      </Link>
    </section>
  );
}

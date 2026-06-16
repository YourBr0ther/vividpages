import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

import { auth } from '@/auth';
import { CharacterCard } from '@/components/character-card';
import { MinorCastDisclosure } from '@/components/minor-cast-disclosure';
import { findOwnedBook } from '@/lib/find-owned-book';
import { listCast, type CastMember } from '@/lib/queries';

type PageProps = { params: Promise<{ id: string }> };

// Deduped across generateMetadata + the page render.
const loadOwnedBook = cache(async (id: string) => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/login');
  return findOwnedBook(id, userId);
});

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const book = await loadOwnedBook(id);
  return { title: book ? `The Cast · ${book.title}` : 'VividPages' };
}

function SectionHeading({ label, count, tint }: { label: string; count: number; tint: string }) {
  return (
    <div className="flex items-center gap-4">
      <h2 className={`shrink-0 text-xs font-semibold uppercase tracking-[0.3em] ${tint}`}>
        {label}
      </h2>
      <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-stone-700/60 to-transparent" />
      <span className="text-xs tabular-nums text-stone-600">{count}</span>
    </div>
  );
}

function CardGrid({
  members,
  bookId,
  cast,
}: {
  members: CastMember[];
  bookId: string;
  cast: CastMember[];
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {members.map((member) => (
        <CharacterCard key={member.id} member={member} bookId={bookId} cast={cast} />
      ))}
    </div>
  );
}

/**
 * The dramatis personae: every character the analysis discovered, split into
 * the main cast (followed across the book) and the long tail of minor
 * characters, folded away behind a disclosure.
 */
export default async function CastPage({ params }: PageProps) {
  const { id } = await params;
  const book = await loadOwnedBook(id);
  if (!book) notFound();

  const cast = await listCast(book.id);
  const main = cast.filter((m) => m.role === 'main');
  const minor = cast.filter((m) => m.role === 'minor');

  return (
    <div className="animate-rise">
      <nav aria-label="Breadcrumb">
        <Link
          href={`/books/${book.id}`}
          className="text-sm text-stone-500 transition hover:text-parchment focus-visible:ring-2 focus-visible:ring-ember-400/70"
        >
          ← {book.title}
        </Link>
      </nav>

      <header className="mt-8">
        <h1 className="font-display text-4xl tracking-tight text-parchment sm:text-5xl">
          The Cast
        </h1>
        <p className="mt-3 text-sm text-stone-500">
          {cast.length === 0
            ? 'No characters catalogued yet'
            : `${cast.length} character${cast.length === 1 ? '' : 's'} discovered in “${book.title}”`}
        </p>
      </header>

      <div
        aria-hidden
        className="mt-10 h-px w-full bg-gradient-to-r from-ember-400/40 via-stone-700/60 to-transparent"
      />

      {cast.length === 0 ? (
        <section className="mt-12 flex flex-col items-center gap-4 rounded-xl border border-dashed border-stone-700/80 bg-stone-900/30 px-6 py-16 text-center">
          <span aria-hidden className="font-display text-5xl text-stone-700">
            ❦
          </span>
          <h2 className="font-display text-2xl tracking-tight text-parchment">
            The cast hasn&rsquo;t been discovered yet
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-stone-500">
            Run the analysis from the book&rsquo;s page and VividPages will study every scene,
            catalogue the characters, and sketch a visual profile for each of them.
          </p>
          <Link
            href={`/books/${book.id}`}
            className="mt-2 inline-flex items-center gap-2 rounded-full bg-ember-400 px-5 py-2 text-sm font-semibold text-stone-950 shadow-[0_10px_30px_-10px_rgba(224,155,59,0.55)] transition hover:bg-ember-300 focus-visible:ring-2 focus-visible:ring-ember-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950"
          >
            Go to analysis controls <span aria-hidden>→</span>
          </Link>
        </section>
      ) : (
        <div className="mt-12 space-y-14">
          {main.length > 0 ? (
            <section aria-label="Main cast" className="space-y-6">
              <SectionHeading label="Main cast" count={main.length} tint="text-ember-300" />
              <CardGrid members={main} bookId={book.id} cast={cast} />
            </section>
          ) : null}

          {minor.length > 0 ? (
            <section aria-label="Minor characters" className="space-y-6">
              <SectionHeading label="Minor characters" count={minor.length} tint="text-stone-500" />
              <MinorCastDisclosure count={minor.length}>
                <CardGrid members={minor} bookId={book.id} cast={cast} />
              </MinorCastDisclosure>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

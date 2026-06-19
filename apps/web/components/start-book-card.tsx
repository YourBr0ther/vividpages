'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { UploadWizard } from './upload-wizard';

/**
 * Shown on the detail page for a book that was uploaded but never started
 * (status 'uploading' — e.g. the upload wizard was dismissed). Re-opens the
 * same wizard so the user can set the up-front choices and kick off the
 * auto-chained pipeline.
 */
export function StartBookCard({
  bookId,
  bookTitle,
  initialMature,
}: {
  bookId: string;
  bookTitle: string;
  initialMature: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <section
      aria-label="Generate illustrations"
      className="rounded-xl border border-stone-800/70 bg-stone-900/40 p-5"
    >
      <h2 className="font-display text-lg tracking-tight text-parchment">
        Generate illustrations
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-stone-500">
        This book is on the shelf but hasn&rsquo;t been started. Choose your options and
        VividPages will read it, study the cast, and paint every scene — hands-off.
      </p>
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full bg-ember-400 px-5 py-1.5 text-sm font-semibold text-stone-950 transition hover:bg-ember-300 focus-visible:ring-2 focus-visible:ring-ember-400/70"
        >
          Start generation
        </button>
      </div>

      {open ? (
        <UploadWizard
          bookId={bookId}
          bookTitle={bookTitle}
          initialMature={initialMature}
          onFinished={() => {
            setOpen(false);
            router.refresh();
          }}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}

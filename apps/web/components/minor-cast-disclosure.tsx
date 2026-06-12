'use client';

import { useState, type ReactNode } from 'react';

/**
 * Collapses the long tail of minor characters behind a quiet disclosure so
 * the leads carry the page. The server renders the cards as `children`; this
 * client wrapper only toggles their visibility.
 */
export function MinorCastDisclosure({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-2 rounded-full border border-stone-700 px-4 py-1.5 text-sm text-stone-400 transition hover:border-stone-600 hover:text-parchment focus-visible:ring-2 focus-visible:ring-ember-400/70"
      >
        {open
          ? 'Hide minor characters'
          : `Show ${count} minor character${count === 1 ? '' : 's'}`}
        <span aria-hidden className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>
      {open ? <div className="mt-6 animate-rise">{children}</div> : null}
    </div>
  );
}

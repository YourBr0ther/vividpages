'use client';

import { useRef, useState, type DragEvent } from 'react';

function BookPlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className={className} aria-hidden>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Z" />
      <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
      <path d="M12 7.5v5M9.5 10h5" />
    </svg>
  );
}

/**
 * EPUB drop zone + click-to-browse. `tile` renders as a book-shaped cell in
 * the shelf grid; `hero` is the wide empty-state panel.
 */
export function UploadDrop({
  onFile,
  variant,
}: {
  onFile: (file: File) => void;
  variant: 'tile' | 'hero';
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  const dragHandlers = {
    onDragOver: (event: DragEvent) => {
      event.preventDefault();
      setDragOver(true);
    },
    onDragLeave: () => setDragOver(false),
    onDrop: handleDrop,
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept=".epub,application/epub+zip"
      className="hidden"
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) onFile(file);
        // Allow re-selecting the same file after an error.
        event.target.value = '';
      }}
    />
  );

  if (variant === 'hero') {
    return (
      <div
        {...dragHandlers}
        className={`animate-rise rounded-lg border border-dashed px-8 py-20 text-center transition-colors sm:py-24 ${
          dragOver
            ? 'border-ember-400/70 bg-ember-400/5'
            : 'border-stone-700/80 bg-stone-900/40'
        }`}
      >
        {input}
        <BookPlusIcon className="mx-auto h-10 w-10 text-ember-400/80" />
        <h2 className="mt-6 font-display text-3xl tracking-tight text-parchment sm:text-4xl">
          Your shelf is waiting
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-stone-400">
          Drop an EPUB here and VividPages will read it, find its scenes, and — soon —
          paint them. Your first book starts the collection.
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-8 rounded-full bg-ember-400 px-5 py-2 text-sm font-semibold text-stone-950 transition hover:bg-ember-300"
        >
          Add your first book
        </button>
        <p className="mt-3 text-xs text-stone-600">.epub up to 100 MB</p>
      </div>
    );
  }

  return (
    // The hidden input lives outside the button: <input> is not valid inside
    // <button>, and display:none keeps it from becoming a grid item.
    <>
      {input}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        {...dragHandlers}
        className={`flex aspect-[2/3] flex-col items-center justify-center gap-3 rounded-[3px] border border-dashed px-3 text-center transition-colors ${
          dragOver
            ? 'border-ember-400/70 bg-ember-400/5 text-ember-300'
            : 'border-stone-700/70 bg-stone-900/30 text-stone-500 hover:border-ember-400/50 hover:text-ember-300/90'
        }`}
      >
        <BookPlusIcon className="h-7 w-7" />
        <span className="text-xs font-medium uppercase tracking-[0.2em]">Add a book</span>
        <span className="text-[10px] text-stone-600">drop an .epub</span>
      </button>
    </>
  );
}

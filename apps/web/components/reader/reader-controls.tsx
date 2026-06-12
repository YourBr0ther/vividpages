'use client';

import { useEffect, useId, useRef, useState } from 'react';

export type ReaderTheme = 'light' | 'sepia' | 'dark';
export type ReaderFontSize = 's' | 'm' | 'l' | 'xl';

export const READER_THEMES: ReaderTheme[] = ['light', 'sepia', 'dark'];
export const READER_FONT_SIZES: ReaderFontSize[] = ['s', 'm', 'l', 'xl'];

const THEME_OPTIONS: Array<{ id: ReaderTheme; label: string; bg: string; fg: string }> = [
  { id: 'light', label: 'Paper', bg: '#f3ebd9', fg: '#2e261b' },
  { id: 'sepia', label: 'Sepia', bg: '#e9d8b6', fg: '#44331e' },
  { id: 'dark', label: 'Ink', bg: '#131110', fg: '#d9d0bf' },
];

const SIZE_OPTIONS: Array<{ id: ReaderFontSize; label: string }> = [
  { id: 's', label: 'S' },
  { id: 'm', label: 'M' },
  { id: 'l', label: 'L' },
  { id: 'xl', label: 'XL' },
];

/**
 * The "Aa" button + its popover: reading theme swatches and font-size steps.
 * Selections apply instantly (data attributes on the reader surface) and are
 * persisted by the parent.
 */
export function ReaderControls({
  theme,
  size,
  onThemeChange,
  onSizeChange,
}: {
  theme: ReaderTheme;
  size: ReaderFontSize;
  onThemeChange: (theme: ReaderTheme) => void;
  onSizeChange: (size: ReaderFontSize) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={popId}
        aria-label="Display settings"
        title="Display settings"
        onClick={() => setOpen((value) => !value)}
        className="reader-btn h-9 w-9 rounded-full font-display text-sm"
        data-active={open || undefined}
      >
        Aa
      </button>

      {open ? (
        <div
          id={popId}
          role="group"
          aria-label="Display settings"
          className="reader-pop absolute right-0 top-full mt-2 w-60 animate-fade-in rounded-xl p-4"
        >
          <p
            className="text-[10px] font-medium uppercase tracking-[0.25em]"
            style={{ color: 'var(--reader-muted)' }}
          >
            Theme
          </p>
          <div className="mt-2.5 flex items-center gap-2.5">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={theme === option.id}
                onClick={() => onThemeChange(option.id)}
                className="reader-btn flex-1 flex-col gap-1.5 rounded-lg px-2 py-2 text-[11px]"
              >
                <span
                  aria-hidden
                  className="block h-6 w-6 rounded-full border"
                  style={{
                    backgroundColor: option.bg,
                    borderColor: 'var(--reader-border)',
                    boxShadow: `inset 0 0 0 2px ${option.bg}, inset 0 -8px 0 0 ${option.fg}22`,
                  }}
                />
                {option.label}
              </button>
            ))}
          </div>

          <p
            className="mt-4 text-[10px] font-medium uppercase tracking-[0.25em]"
            style={{ color: 'var(--reader-muted)' }}
          >
            Text size
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            {SIZE_OPTIONS.map((option, i) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={size === option.id}
                aria-label={`Text size ${option.label}`}
                onClick={() => onSizeChange(option.id)}
                className="reader-btn h-9 flex-1 rounded-lg font-reading"
                style={{ fontSize: `${0.8 + i * 0.12}rem` }}
              >
                Aa
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

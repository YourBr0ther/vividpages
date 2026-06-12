'use client';

import { useEffect, useRef, useState } from 'react';

import type { BookProgressEvent } from '@/lib/progress-types';

export interface BookProgressState {
  /** Book lifecycle status; null until the first event arrives. */
  status: BookProgressEvent['status'] | null;
  stage: string | null;
  percent: number | null;
  currentStep: string | null;
  error: string | null;
  /** True while the EventSource connection is open. */
  connected: boolean;
}

const INITIAL_STATE: BookProgressState = {
  status: null,
  stage: null,
  percent: null,
  currentStep: null,
  error: null,
  connected: false,
};

/** Reconnect delays after an unexpected drop; gives up after the last one. */
const RETRY_DELAYS_MS = [2000, 5000, 10_000];

/**
 * Subscribes to /api/books/[id]/events (SSE) and exposes the latest pipeline
 * progress. The server closes the stream once the book reaches a terminal
 * status (ready | failed); that close is treated as completion, not an error.
 * Unexpected drops are retried with backoff (2s/5s/10s, then give up).
 *
 * A failed book that gets retried server-side will flip back to a running
 * status; remount the hook (or change `enabled`) to re-subscribe after that.
 */
export function useBookProgress(
  bookId: string | null,
  opts: { enabled?: boolean } = {},
): BookProgressState {
  const enabled = opts.enabled ?? true;
  const [state, setState] = useState<BookProgressState>(INITIAL_STATE);

  // Mirrors the latest status for use inside EventSource callbacks without
  // re-running the effect on every event.
  const statusRef = useRef<BookProgressState['status']>(null);

  useEffect(() => {
    // SSR/no-op guard: EventSource only exists in the browser.
    if (!bookId || !enabled || typeof EventSource === 'undefined') {
      setState(INITIAL_STATE);
      statusRef.current = null;
      return;
    }

    let disposed = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;

    const connect = () => {
      if (disposed) return;
      source = new EventSource(`/api/books/${bookId}/events`);

      source.onopen = () => {
        retries = 0;
        setState((prev) => ({ ...prev, connected: true }));
      };

      source.onmessage = (e: MessageEvent<string>) => {
        let event: BookProgressEvent;
        try {
          event = JSON.parse(e.data) as BookProgressEvent;
        } catch {
          console.error('useBookProgress: unparseable SSE payload', e.data);
          return;
        }
        statusRef.current = event.status;
        setState({
          status: event.status,
          stage: event.stage,
          percent: event.percent,
          currentStep: event.currentStep,
          error: event.error,
          connected: true,
        });
      };

      source.onerror = () => {
        source?.close();
        source = null;
        setState((prev) => ({ ...prev, connected: false }));
        if (disposed) return;

        // Terminal: the server closes the stream after ready/failed, which
        // surfaces here as an error event. Don't reconnect.
        const status = statusRef.current;
        if (status === 'ready' || status === 'failed') return;

        const delay = RETRY_DELAYS_MS[retries];
        if (delay === undefined) return; // Out of retries.
        retries += 1;
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      source?.close();
      setState(INITIAL_STATE);
      statusRef.current = null;
    };
  }, [bookId, enabled]);

  return state;
}

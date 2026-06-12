import { books, getDb, pipelineRuns } from '@vividpages/db';
import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { findOwnedBook } from '@/lib/find-owned-book';
import type { BookProgressEvent } from '@/lib/progress-types';

// SSE responses must never be statically optimized or cached.
export const dynamic = 'force-dynamic';

const POLL_MS = 1500;
const HEARTBEAT_MS = 15_000;

const encoder = new TextEncoder();

/** Builds the current progress snapshot for a book, or null if it vanished. */
async function snapshot(bookId: string): Promise<BookProgressEvent | null> {
  const db = getDb();
  const [book, [latestRun]] = await Promise.all([
    db.query.books.findFirst({ where: eq(books.id, bookId) }),
    db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.bookId, bookId))
      .orderBy(desc(pipelineRuns.startedAt))
      .limit(1),
  ]);
  if (!book) return null;
  return {
    bookId: book.id,
    status: book.status,
    runStatus: latestRun?.status ?? null,
    stage: latestRun?.stage ?? null,
    percent: latestRun?.percent ?? null,
    currentStep: latestRun?.currentStep ?? null,
    error: latestRun?.error ?? book.error ?? null,
  };
}

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/books/[id]/events — Server-Sent Events stream of pipeline
 * progress. Emits one snapshot immediately, then only when the payload
 * changes (polled every 1.5s), plus a `: ping` heartbeat every 15s.
 *
 * The stream closes after emitting a snapshot whose book status is terminal
 * (ready | failed). A failed book can flip back to running on retry; clients
 * are expected to reconnect in that case (the hook handles this).
 */
export async function GET(request: Request, { params }: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const { id } = await params;
  const book = await findOwnedBook(id, userId);
  if (!book) {
    return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
  }

  const bookId = book.id;

  // Shared with the stream's cancel() handler so a dropped connection stops
  // the polling/heartbeat timers immediately.
  let close = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Client may already be gone by the time the stream starts (auth +
      // ownership lookups above are async) — don't begin polling at all.
      if (request.signal.aborted) {
        controller.close();
        return;
      }

      let pollTimer: ReturnType<typeof setInterval> | undefined;
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
      let closed = false;
      let polling = false;
      let lastPayload = '';

      close = () => {
        if (closed) return;
        closed = true;
        clearInterval(pollTimer);
        clearInterval(heartbeatTimer);
        request.signal.removeEventListener('abort', close);
        try {
          controller.close();
        } catch {
          // Already closed/errored (e.g. client went away mid-write).
        }
      };

      const send = (text: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(text));
          return true;
        } catch {
          // Client disconnected without firing abort yet.
          close();
          return false;
        }
      };

      const poll = async () => {
        if (closed || polling) return;
        polling = true;
        try {
          const event = await snapshot(bookId);
          if (closed) return;
          if (!event) {
            // Book deleted mid-stream: nothing left to report.
            close();
            return;
          }
          const payload = JSON.stringify(event);
          if (payload !== lastPayload) {
            lastPayload = payload;
            if (!send(`data: ${payload}\n\n`)) return;
            if (event.status === 'ready' || event.status === 'failed') close();
          }
        } catch (err) {
          console.error(`events: poll failed for book ${bookId}:`, err);
          close();
        } finally {
          polling = false;
        }
      };

      request.signal.addEventListener('abort', close);
      pollTimer = setInterval(() => void poll(), POLL_MS);
      heartbeatTimer = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
      void poll(); // Initial snapshot, emitted immediately.
    },
    // Runtime signals the consumer went away (dropped connection): stop
    // polling right away instead of waiting for the next failed write.
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

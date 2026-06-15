import { Readable } from 'node:stream';

import { getObjectStream } from '@vividpages/core/storage';
import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { findOwnedImage } from '@/lib/find-owned-image';

type RouteContext = { params: Promise<{ imageId: string }> };

/**
 * GET /api/images/[imageId] — streams a generated image from MinIO.
 *
 * - `?thumb=1` streams the 384px thumbnail instead of the full render.
 * - `?meta=1` returns the image's provenance as JSON (prompt, seed, params…)
 *   instead of bytes — the lightbox's details panel fetches this lazily.
 *
 * Object keys are versioned (a regeneration writes a NEW row + key), so the
 * bytes behind an id never change: immutable private caching is safe.
 * 404 for missing/unowned images and rows whose object hasn't landed yet.
 */
export async function GET(request: Request, { params }: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const { imageId } = await params;
  const owned = await findOwnedImage(imageId, userId);
  if (!owned) {
    return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
  }
  const { image } = owned;

  const searchParams = new URL(request.url).searchParams;

  if (searchParams.get('meta') === '1') {
    return NextResponse.json(
      {
        id: image.id,
        kind: image.kind,
        subjectId: image.subjectId,
        status: image.status,
        version: image.version,
        prompt: image.prompt,
        negativePrompt: image.negativePrompt,
        provider: image.provider,
        model: image.model,
        // bigint doesn't survive JSON.stringify; seeds read fine as strings.
        seed: image.seed?.toString() ?? null,
        params: image.params,
        width: image.width,
        height: image.height,
        createdAt: image.createdAt,
      },
      // Status flips pending→done on the same row, so no immutable caching here.
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const key = searchParams.get('thumb') === '1' ? image.thumbObjectKey : image.objectKey;
  if (!key) {
    return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
  }

  let stream: Readable;
  try {
    stream = await getObjectStream('images', key);
  } catch (error) {
    // DB row exists but the object is gone (or storage hiccuped): log and
    // 404 rather than 500ing the reader.
    console.error(`images: failed to read s3://images/${key}:`, error);
    return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
  }

  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}

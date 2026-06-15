import { getDb, images } from '@vividpages/db';
import { eq } from 'drizzle-orm';

import { findOwnedBook, UUID_RE } from './find-owned-book';

export type ImageRow = typeof images.$inferSelect;

/**
 * Loads the image only if its book belongs to the user. Returns the image row
 * plus the (already-loaded) book so callers needing book state don't re-query.
 * `undefined` for missing/unowned images and non-UUID ids — callers treat it
 * as 404 (no existence leak).
 */
export async function findOwnedImage(
  imageId: string,
  userId: string,
): Promise<{ image: ImageRow; book: NonNullable<Awaited<ReturnType<typeof findOwnedBook>>> } | undefined> {
  if (!UUID_RE.test(imageId)) return undefined;
  const image = await getDb().query.images.findFirst({ where: eq(images.id, imageId) });
  if (!image) return undefined;
  const book = await findOwnedBook(image.bookId, userId);
  return book ? { image, book } : undefined;
}

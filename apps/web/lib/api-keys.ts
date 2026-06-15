import { decryptSecret } from '@vividpages/core/crypto';
import { apiKeys, getDb, type ApiKeyProvider } from '@vividpages/db';
import { and, eq } from 'drizzle-orm';

/**
 * Server-side: returns the decrypted API key for (userId, provider), or null
 * when no key is stored. Used by the settings "Test" endpoint and any future
 * server code that needs a user's cloud key. NEVER expose the result to the
 * client.
 */
export async function getDecryptedKey(
  userId: string,
  provider: ApiKeyProvider,
): Promise<string | null> {
  const db = getDb();
  const row = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider)),
    columns: { ciphertext: true },
  });
  if (!row) return null;
  return decryptSecret(row.ciphertext);
}

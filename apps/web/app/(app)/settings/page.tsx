import { apiKeys, getDb, userSettings } from '@vividpages/db';
import { asc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';

import { SettingsClient, type MaskedKey, type SettingsValues } from './settings-client';

/** Mirrors the user_settings column defaults (packages/db schema). */
const DEFAULTS: SettingsValues = {
  llmProvider: 'ollama',
  llmModel: 'llama3.1:8b',
  embeddingProvider: 'ollama',
  embeddingModel: 'nomic-embed-text',
  imageProvider: 'comfyui',
  imageModel: null,
  ollamaUrl: null,
  comfyuiUrl: null,
};

/**
 * Settings: API keys (encrypted at rest), default providers/models, and local
 * endpoint overrides. Server component loads the initial state; the client
 * component drives saves/tests/removes.
 */
export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const userId = session.user.id;
  const db = getDb();

  const [settingsRow, keyRows] = await Promise.all([
    db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) }),
    db
      .select({
        provider: apiKeys.provider,
        label: apiKeys.label,
        lastFour: apiKeys.lastFour,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .orderBy(asc(apiKeys.provider)),
  ]);

  const settings: SettingsValues = settingsRow
    ? {
        llmProvider: settingsRow.llmProvider as SettingsValues['llmProvider'],
        llmModel: settingsRow.llmModel,
        embeddingProvider: settingsRow.embeddingProvider as SettingsValues['embeddingProvider'],
        embeddingModel: settingsRow.embeddingModel,
        imageProvider: settingsRow.imageProvider as SettingsValues['imageProvider'],
        imageModel: settingsRow.imageModel,
        ollamaUrl: settingsRow.ollamaUrl,
        comfyuiUrl: settingsRow.comfyuiUrl,
      }
    : DEFAULTS;

  // ISO-serialize Dates for the client boundary.
  const keys: MaskedKey[] = keyRows.map((k) => ({
    provider: k.provider,
    label: k.label,
    lastFour: k.lastFour,
    createdAt: k.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-10">
      <header>
        <p className="font-display text-xs uppercase tracking-[0.3em] text-ember-400/70">
          Configuration
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-parchment">Settings</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-400">
          Choose which engines illustrate your books. Cloud keys are encrypted at rest and never
          shown again after you save them. Leave endpoint overrides blank to use the server
          defaults.
        </p>
      </header>

      <SettingsClient initialSettings={settings} initialKeys={keys} />
    </div>
  );
}

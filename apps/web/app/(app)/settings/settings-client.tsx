'use client';

import { useState } from 'react';

import { ToastViewport, useToasts } from '@/components/toasts';

// ---------------------------------------------------------------------------
// Shared types (the page serializes Dates to ISO strings at the boundary).
// ---------------------------------------------------------------------------

export type KeyProvider = 'anthropic' | 'openai';

export interface MaskedKey {
  provider: string;
  label: string | null;
  lastFour: string | null;
  createdAt: string;
}

export interface SettingsValues {
  llmProvider: 'ollama' | 'anthropic' | 'openai';
  llmModel: string;
  embeddingProvider: 'ollama' | 'openai';
  embeddingModel: string;
  imageProvider: 'comfyui' | 'openai';
  imageModel: string | null;
  ollamaUrl: string | null;
  comfyuiUrl: string | null;
}

// ---------------------------------------------------------------------------
// Provider/model catalogues (used to populate the dropdowns).
// ---------------------------------------------------------------------------

const LLM_MODELS: Record<SettingsValues['llmProvider'], string[]> = {
  ollama: ['llama3.1:8b', 'qwen2.5:14b'],
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-8'],
  openai: ['gpt-4.1'],
};

const EMBEDDING_MODELS: Record<SettingsValues['embeddingProvider'], string[]> = {
  ollama: ['nomic-embed-text'],
  openai: ['text-embedding-3-small', 'text-embedding-3-large'],
};

const IMAGE_MODELS: Record<SettingsValues['imageProvider'], string[]> = {
  comfyui: [],
  openai: ['gpt-image-1', 'dall-e-3'],
};

const KEY_PROVIDERS: { id: KeyProvider; name: string; hint: string }[] = [
  { id: 'anthropic', name: 'Anthropic', hint: 'sk-ant-…' },
  { id: 'openai', name: 'OpenAI', hint: 'sk-…' },
];

// ---------------------------------------------------------------------------
// Small presentational atoms — kept local to this feature.
// ---------------------------------------------------------------------------

const sectionClass =
  'rounded-2xl border border-stone-800/70 bg-stone-900/40 p-6 shadow-lg shadow-black/20';
const labelClass = 'block font-display text-xs uppercase tracking-[0.18em] text-stone-400';
const inputClass =
  'mt-1.5 w-full rounded-lg border border-stone-700/70 bg-stone-950/60 px-3 py-2 text-sm text-parchment outline-none transition placeholder:text-stone-600 focus:border-ember-400/60 focus:ring-2 focus:ring-ember-400/30';
const selectClass = inputClass;
const primaryBtn =
  'rounded-full bg-ember-500/90 px-4 py-1.5 text-sm font-medium text-stone-950 transition hover:bg-ember-400 disabled:cursor-not-allowed disabled:opacity-50';
const ghostBtn =
  'rounded-full border border-stone-700/70 px-4 py-1.5 text-sm text-stone-300 transition hover:border-stone-500 hover:text-parchment disabled:opacity-50';

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className={labelClass}>{label}</span>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// API key row: masked when set, input + Save when not; Test + Remove actions.
// ---------------------------------------------------------------------------

function ApiKeyRow({
  provider,
  name,
  hint,
  stored,
  onChange,
  notify,
}: {
  provider: KeyProvider;
  name: string;
  hint: string;
  stored: MaskedKey | undefined;
  onChange: (next: MaskedKey | null) => void;
  notify: (tone: 'info' | 'error', msg: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<null | 'save' | 'test' | 'remove'>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);

  async function save() {
    if (!draft.trim()) return;
    setBusy('save');
    setTestResult(null);
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, apiKey: draft.trim() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Save failed.');
      const { key } = await res.json();
      onChange(key);
      setDraft('');
      notify('info', `${name} key saved.`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Could not save the key.');
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy('test');
    setTestResult(null);
    try {
      // Test the typed draft if present, else the stored key.
      const body: { provider: KeyProvider; apiKey?: string } = { provider };
      if (draft.trim()) body.apiKey = draft.trim();
      const res = await fetch('/api/keys/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; detail?: string };
      setTestResult({ ok: data.ok, detail: data.detail ?? (data.ok ? 'Key works.' : 'Test failed.') });
    } catch {
      setTestResult({ ok: false, detail: 'Could not reach the test endpoint.' });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('remove');
    setTestResult(null);
    try {
      const res = await fetch(`/api/keys/${provider}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error('Remove failed.');
      onChange(null);
      notify('info', `${name} key removed.`);
    } catch {
      notify('error', 'Could not remove the key.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div data-testid={`api-key-${provider}`} className="rounded-xl border border-stone-800/60 bg-stone-950/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-base text-parchment">{name}</h3>
        {stored ? (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-950/30 px-2.5 py-0.5 text-xs text-emerald-300">
            Connected
          </span>
        ) : (
          <span className="rounded-full border border-stone-700/60 px-2.5 py-0.5 text-xs text-stone-500">
            Not set
          </span>
        )}
      </div>

      {stored ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <code className="rounded-md bg-stone-900/80 px-3 py-1.5 text-sm text-stone-300">
            {`sk-…${stored.lastFour ?? '????'}`}
          </code>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={test} disabled={busy !== null} className={ghostBtn}>
              {busy === 'test' ? 'Testing…' : 'Test'}
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy !== null}
              className="rounded-full border border-red-500/40 px-4 py-1.5 text-sm text-red-300 transition hover:bg-red-950/40 disabled:opacity-50"
            >
              {busy === 'remove' ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-[16rem] flex-1">
            <span className="sr-only">{name} API key</span>
            <input
              type="password"
              autoComplete="off"
              value={draft}
              placeholder={hint}
              onChange={(e) => setDraft(e.target.value)}
              className={inputClass}
            />
          </label>
          <button type="button" onClick={save} disabled={busy !== null || !draft.trim()} className={primaryBtn}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={test} disabled={busy !== null || !draft.trim()} className={ghostBtn}>
            {busy === 'test' ? 'Testing…' : 'Test'}
          </button>
        </div>
      )}

      {testResult ? (
        <p
          role="status"
          className={`mt-3 text-sm ${testResult.ok ? 'text-emerald-300' : 'text-red-300'}`}
        >
          {testResult.ok ? '✓ ' : '✕ '}
          {testResult.detail}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main client component.
// ---------------------------------------------------------------------------

export function SettingsClient({
  initialSettings,
  initialKeys,
}: {
  initialSettings: SettingsValues;
  initialKeys: MaskedKey[];
}) {
  const { toasts, pushToast, dismissToast } = useToasts();
  const [keys, setKeys] = useState<MaskedKey[]>(initialKeys);
  const [settings, setSettings] = useState<SettingsValues>(initialSettings);
  const [saving, setSaving] = useState(false);

  const keyFor = (p: KeyProvider) => keys.find((k) => k.provider === p);

  function setKey(provider: KeyProvider, next: MaskedKey | null) {
    setKeys((current) => {
      const rest = current.filter((k) => k.provider !== provider);
      return next ? [...rest, next] : rest;
    });
  }

  // When the provider changes, snap the model to that provider's first option
  // if the current model isn't valid for it.
  function setLlmProvider(provider: SettingsValues['llmProvider']) {
    setSettings((s) => ({
      ...s,
      llmProvider: provider,
      llmModel: LLM_MODELS[provider].includes(s.llmModel)
        ? s.llmModel
        : (LLM_MODELS[provider][0] ?? s.llmModel),
    }));
  }
  function setEmbeddingProvider(provider: SettingsValues['embeddingProvider']) {
    setSettings((s) => ({
      ...s,
      embeddingProvider: provider,
      embeddingModel: EMBEDDING_MODELS[provider].includes(s.embeddingModel)
        ? s.embeddingModel
        : (EMBEDDING_MODELS[provider][0] ?? s.embeddingModel),
    }));
  }
  function setImageProvider(provider: SettingsValues['imageProvider']) {
    setSettings((s) => ({
      ...s,
      imageProvider: provider,
      imageModel:
        provider === 'comfyui' ? null : (IMAGE_MODELS[provider][0] ?? s.imageModel),
    }));
  }

  async function saveSettings() {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not save settings.');
      }
      pushToast('info', 'Settings saved.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* API keys -------------------------------------------------------- */}
      <section aria-labelledby="keys-heading" className={sectionClass}>
        <h2 id="keys-heading" className="font-display text-xl tracking-tight text-parchment">
          API keys
        </h2>
        <p className="mt-1 text-sm text-stone-400">
          Required only for cloud providers. Stored encrypted; we keep only the last four
          characters for display.
        </p>
        <div className="mt-5 space-y-4">
          {KEY_PROVIDERS.map((p) => (
            <ApiKeyRow
              key={p.id}
              provider={p.id}
              name={p.name}
              hint={p.hint}
              stored={keyFor(p.id)}
              onChange={(next) => setKey(p.id, next)}
              notify={pushToast}
            />
          ))}
        </div>
      </section>

      {/* Defaults -------------------------------------------------------- */}
      <section aria-labelledby="defaults-heading" className={`${sectionClass} mt-8`}>
        <h2 id="defaults-heading" className="font-display text-xl tracking-tight text-parchment">
          Default engines
        </h2>
        <p className="mt-1 text-sm text-stone-400">
          Used for new books unless a book overrides them.
        </p>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label="Language model">
            <select
              value={settings.llmProvider}
              onChange={(e) => setLlmProvider(e.target.value as SettingsValues['llmProvider'])}
              className={selectClass}
              aria-label="LLM provider"
            >
              <option value="ollama">Ollama (local)</option>
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
            </select>
          </Field>
          <Field label="LLM model">
            <select
              value={settings.llmModel}
              onChange={(e) => setSettings((s) => ({ ...s, llmModel: e.target.value }))}
              className={selectClass}
              aria-label="LLM model"
            >
              {LLM_MODELS[settings.llmProvider].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Embeddings">
            <select
              value={settings.embeddingProvider}
              onChange={(e) =>
                setEmbeddingProvider(e.target.value as SettingsValues['embeddingProvider'])
              }
              className={selectClass}
              aria-label="Embedding provider"
            >
              <option value="ollama">Ollama (local)</option>
              <option value="openai">OpenAI</option>
            </select>
          </Field>
          <Field label="Embedding model">
            <select
              value={settings.embeddingModel}
              onChange={(e) => setSettings((s) => ({ ...s, embeddingModel: e.target.value }))}
              className={selectClass}
              aria-label="Embedding model"
            >
              {EMBEDDING_MODELS[settings.embeddingProvider].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Illustrations">
            <select
              value={settings.imageProvider}
              onChange={(e) => setImageProvider(e.target.value as SettingsValues['imageProvider'])}
              className={selectClass}
              aria-label="Image provider"
            >
              <option value="comfyui">ComfyUI (local)</option>
              <option value="openai">OpenAI</option>
            </select>
          </Field>
          {settings.imageProvider === 'openai' ? (
            <Field label="Image model">
              <select
                value={settings.imageModel ?? IMAGE_MODELS.openai[0]}
                onChange={(e) => setSettings((s) => ({ ...s, imageModel: e.target.value }))}
                className={selectClass}
                aria-label="Image model"
              >
                {IMAGE_MODELS.openai.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <div className="flex items-end text-sm text-stone-500">
              Uses the server&rsquo;s ComfyUI workflow.
            </div>
          )}
        </div>
      </section>

      {/* Local endpoints ------------------------------------------------- */}
      <section aria-labelledby="endpoints-heading" className={`${sectionClass} mt-8`}>
        <h2 id="endpoints-heading" className="font-display text-xl tracking-tight text-parchment">
          Local endpoints
        </h2>
        <p className="mt-1 text-sm text-stone-400">
          Override where local engines live. Leave blank to use the server defaults.
        </p>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label="Ollama URL">
            <input
              type="url"
              inputMode="url"
              value={settings.ollamaUrl ?? ''}
              placeholder="http://localhost:11434"
              onChange={(e) =>
                setSettings((s) => ({ ...s, ollamaUrl: e.target.value || null }))
              }
              className={inputClass}
            />
          </Field>
          <Field label="ComfyUI URL">
            <input
              type="url"
              inputMode="url"
              value={settings.comfyuiUrl ?? ''}
              placeholder="http://localhost:8000"
              onChange={(e) =>
                setSettings((s) => ({ ...s, comfyuiUrl: e.target.value || null }))
              }
              className={inputClass}
            />
          </Field>
        </div>
      </section>

      <div className="mt-8 flex justify-end">
        <button type="button" onClick={saveSettings} disabled={saving} className={primaryBtn}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

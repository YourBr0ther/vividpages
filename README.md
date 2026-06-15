# VividPages

**Turn EPUB books into illustrated reading experiences.** VividPages analyzes a
book scene-by-scene with an LLM, discovers and tracks its characters, and
generates character-consistent storyboard art that appears inline as you read.

It's a self-hosted, multi-user PWA. Bring your own AI — run everything locally
against Ollama + ComfyUI, or plug in Claude / OpenAI / DALL·E with your own keys.

> Status: **deployed and working.** The full pipeline runs end-to-end on a real
> ~110k-word novel — 63 chapters → 101 analyzed scenes → a deduplicated cast →
> ~114 generated images — readable in a typographically serious reader with art
> inline. This is a ground-up rebuild of an earlier prototype.

---

## What it does

1. **Ingest** — parses an uploaded EPUB into clean chapter text with exact
   paragraph offsets (used later to place images inline).
2. **Segment** — splits chapters into scenes (explicit breaks + word-count
   targeting, deterministic, no LLM).
3. **Analyze** — one structured LLM call per scene: summary, setting, mood, time
   of day, the key visual moment, and which characters are present (with a
   rolling roster so pronouns/epithets resolve to the right person).
4. **Profiles** — deduplicates characters (name/alias matching + embedding
   similarity + an LLM reconciliation pass) into one canonical visual profile
   each, compiled into a stable **appearance token** reused verbatim in every
   prompt — the character-consistency mechanism.
5. **Imagine** — generates a portrait per main character and a storyboard per
   scene; webp + thumbnail stored in object storage, full provenance (prompt,
   seed, params) recorded for regeneration and version history.

Every stage is a checkpointed queue job, so a crashed worker resumes rather than
restarts, and a transient image-provider blip retries instead of failing the book.

## Experience

- **Reader** — serif typography, light/sepia/dark themes, storyboard plates
  breaking out above each scene's prose, a lightbox with prompt/seed details and
  per-image regenerate + version history, reading-position sync, installable PWA
  with offline reading for books you've opened.
- **Bookcase** with live processing progress, **cast gallery** with portraits,
  **jobs dashboard**, and **settings** with encrypted per-user API keys.

## Architecture

pnpm monorepo, two deployable images:

- **`apps/web`** — Next.js 16 (App Router): UI, REST API, SSE progress, Auth.js.
- **`apps/worker`** — one BullMQ consumer for all pipeline queues.

Shared packages:

- **`@vividpages/db`** — Drizzle schema + client (Postgres + pgvector).
- **`@vividpages/core`** — EPUB parsing, segmentation, pipeline stages, storage,
  crypto, prompt building.
- **`@vividpages/ai`** — provider adapters (Ollama / Anthropic / OpenAI for LLM,
  Ollama / OpenAI for embeddings, ComfyUI / OpenAI for images) behind a registry.

Backing services: Postgres 16 + pgvector, Redis 7, MinIO (S3-compatible).

```
Browser ─HTTP/SSE─▶ web (Next.js) ─enqueue─▶ Redis ─▶ worker
                         │                              │
                         └────────── Postgres ◀─────────┘
                                     MinIO (epubs, images, covers)
   AI (self-hosted or cloud): Ollama · ComfyUI · Claude · OpenAI
```

## Tech stack

TypeScript · Next.js 16 / React 19 · Tailwind 4 · Auth.js v5 · Drizzle ORM ·
BullMQ · Zod · cheerio + fflate (EPUB) · sharp · Vitest · Playwright · Docker.

## Local development

Requires Node 22+, pnpm 9, Docker. An Ollama endpoint (and optionally ComfyUI)
for the AI stages.

```bash
pnpm install
cp .env.example .env          # fill in DATABASE_URL, AUTH_SECRET, ENCRYPTION_KEY, AI endpoints…
docker compose up -d          # postgres + redis + minio
pnpm -F @vividpages/db db:migrate
pnpm -F web dev               # http://localhost:3000
pnpm -F worker dev            # pipeline worker (separate terminal)
```

Generate a secret/key:

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -hex 32      # ENCRYPTION_KEY (64 hex)
```

Tests:

```bash
pnpm -r test                  # unit (Vitest)
pnpm e2e                      # Playwright (needs the dev stack + worker running)
pnpm -r exec tsc --noEmit     # typecheck
```

## Deployment

Production images build from `apps/web/Dockerfile` and `apps/worker/Dockerfile`.
This instance runs on a self-hosted k3s cluster (Postgres/Redis/MinIO as
in-cluster Deployments, Traefik ingress, Authelia SSO at the edge in front of the
app's own Auth.js).

## Legal

EPUBs must be legally obtained; for personal use. Generated images are
transformative works for personal consumption. Comply with the terms of any
third-party AI providers you configure.

## License

MIT

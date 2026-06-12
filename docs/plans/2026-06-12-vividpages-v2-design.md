# VividPages v2 — Design

**Date:** 2026-06-12
**Status:** Approved
**Predecessor:** https://github.com/YourBr0ther/vividpages (v1, ~70% complete, stalled before the reader was built)

## What it is

VividPages transforms EPUB books into immersive visual reading experiences: AI analyzes the
text scene-by-scene, discovers and tracks characters, and generates character-consistent
storyboard art that appears inline as you read.

**v1 milestone:** Upload *Assistant to the Villain* → pipeline runs end-to-end → read it in a
polished reader with scene storyboards inline, character gallery, and progress tracking.

## Key decisions (user-confirmed)

| Decision | Choice |
|---|---|
| Scope | Full platform: multi-user PWA, OAuth, object storage, job queues |
| Stack | Next.js monorepo + single consolidated worker image |
| AI providers | All day one: Ollama + Claude + OpenAI (LLM), Ollama/OpenAI (embeddings), ComfyUI + DALL-E (images) |
| v1 target | Full vivid reader with the provided book |
| Deployment | k3s cluster (`projects/k3s_setup` conventions) |

## Architecture

pnpm monorepo → **two container images**:

- **`web`** — Next.js 16 (App Router). PWA, REST API routes, uploads, **SSE** for live
  progress (not Socket.IO — plays nicely with Next.js/Traefik, no sticky sessions).
- **`worker`** — one Node image running BullMQ consumers for all queues
  (`ingest`, `segment`, `analyze`, `profiles`, `imagine`). Concurrency via env;
  scale by replicas if ever needed. (v1 had four bespoke worker containers — too much.)

Shared packages:
- `@vividpages/db` — Drizzle schema + client
- `@vividpages/core` — EPUB parsing, scene segmentation, pipeline logic
- `@vividpages/ai` — provider adapters (LLM / embeddings / images)

Backing services (k3s namespace `media`, Longhorn PVCs; Docker Compose for local dev):
- Postgres 16 + pgvector (dedicated instance, Immich-style)
- Redis 7 (queues only)
- MinIO (EPUBs, covers, generated images)

AI endpoints (gaming PC, outside cluster):
- Ollama: `http://10.0.2.192:11434`
- ComfyUI: `http://10.0.2.192:8188` (user spins up on demand)

Ingress: `vividpages.hiddencasa.com` via Traefik IngressRoute (Let's Encrypt handled by
cluster). App-level auth (Auth.js: credentials + Google) — no Authelia middleware.

## Pipeline

One **pipeline run** per processing attempt, five stages, each a BullMQ queue, status
checkpointed in Postgres so a crashed worker resumes rather than restarts:

1. **Ingest** — SHA-256 dedup; parse EPUB directly (unzip + XHTML via cheerio/fast-xml-parser,
   NOT epubjs which is a browser renderer); extract metadata + cover; store chapters as clean
   structured text with paragraph offsets.
2. **Segment** — split chapters into scenes. Signals: explicit scene-break markers first,
   LLM-assisted boundary detection for long unbroken chapters. Each scene stores exact
   character offsets into chapter text (this mapping places images inline in the reader).
3. **Analyze** — per scene, one structured LLM call (Zod-validated JSON, retry w/ repair
   prompting): characters present, new descriptions, setting, time of day, mood, key visual
   moment. Sliding context window carries running character roster + previous scene summary
   for pronoun/epithet resolution.
4. **Profiles** — character dedup via embeddings + alias matching (pgvector HNSW); merge into
   one canonical visual profile per character with a stable **appearance token** (compiled
   prompt fragment: hair, eyes, build, attire) reused verbatim in every image prompt — the
   character-consistency mechanism.
5. **Imagine** — generate prompts, then images: portraits per main character + one storyboard
   per scene. ComfyUI (FLUX workflow JSON via API) or DALL-E. Seed/params/prompt stored for
   regeneration.

Progress events: worker → Postgres → SSE → UI.

## Data model (~14 tables, Drizzle)

**Identity:** `users` (argon2), `sessions`, `api_keys` (AES-256-GCM ciphertext+IV+tag, never
returned decrypted), `user_settings` (default providers/models/style, host overrides).

**Text:** `books` (owner, metadata, sha256, status), `chapters` (index, title, text),
`scenes` (chapter, index, char start/end offsets, summary, setting, mood, timeOfDay,
keyVisualMoment, sceneType).

**Characters:** `characters` (canonical name, aliases[], role, appearance profile JSON,
appearance token, embedding vector column — nomic-embed-text 768-dim local / 1536-dim OpenAI),
`scene_characters` (join + per-scene state: outfit/injury changes).

**Images:** `images` (subject type, prompt, negative, provider, model, seed, params, MinIO
key, status, version — old versions kept), `style_presets` (named art-style prompt fragments;
book picks one at upload).

**Ops:** `pipeline_runs` (stage, percent, current step, token/cost tally), `jobs` (BullMQ
mirror for dashboard), `reading_progress` (per user/book, last scene).

Change from v1: embeddings are columns on `characters`, not separate tables. Same HNSW index,
less plumbing.

## Experience (what v1 never shipped)

1. **Reader** — the heart. Typographically serious (serif, adjustable size, dark/sepia/light).
   Storyboard images inline at scene boundaries, full-bleed, fade-in on scroll. Lightbox with
   prompt details, regenerate, version history. Toggle inline/margin/text-only. Position
   auto-saved; keyboard + swipe nav. Character names subtly underlined — tap to peek portrait
   card.
2. **Bookcase** — covers on a shelf; in-flight books show live progress ring with stage label.
   Drag-and-drop upload.
3. **Book detail / Cast** — character gallery, settings gallery, pipeline controls (provider,
   style preset, start/pause/retry per stage, regenerate-all with different preset).
4. **Jobs dashboard** — live queues, retry failed, error details, cost tally per book.
5. **Settings** — masked API keys with test buttons, provider endpoints, default models.

PWA installable; reader works offline for processed books (service worker caches text+images).
Design language: bookish and atmospheric — deep ink/parchment palette, generated art as hero.

## Error handling

- Every LLM call: Zod schema validation, 3× retry with repair prompting.
- Failed scene analysis → scene marked `unanalyzed`, book still readable. Never block.
- Provider health check before run start; fail fast with clear message.
- Stage checkpoints → retry resumes mid-book.
- Individual image retry from UI.

## Testing

- Vitest: parser, segmentation, dedup (fixtures cut from the real EPUB).
- Integration: pipeline against live Ollama.
- Playwright: upload→read smoke test.
- TDD for core logic.

## Build order (reader before AI — the opposite of v1)

- **M1 Foundation:** monorepo, Compose dev stack, schema+migrations, Auth.js.
- **M2 Ingest & segment:** EPUB parser + scene segmentation, unit-tested on the real book.
- **M3 Reader v1:** Bookcase + full text-only reading experience. Book readable before any AI.
- **M4 Analysis & cast:** Ollama adapter, scene analysis, character discovery/dedup, gallery.
- **M5 Art:** ComfyUI adapter, prompts, portraits + storyboards, art in reader, lightbox.
- **M6 Platform:** Claude/OpenAI/DALL-E, encrypted keys, jobs dashboard, PWA offline, polish.
- **M7 Ship:** Docker Hub images (`yourbr0ther/vividpages-web`, `-worker`), k3s manifests
  (310-range), IngressRoute, SOPS secret, deploy.

## k3s deployment notes (from k3s_setup exploration)

- Raw numbered manifests in `k3s_setup/manifests/`, next free range ~310.
- Namespace `media`; Longhorn PVCs (RWO, `strategy: Recreate`); SOPS-encrypted secrets.
- IngressRoute in `139-ingressroutes.yaml` + mirrored to `custom-ingressroutes.yaml` ConfigMap.
- Images: Docker Hub `yourbr0ther/*`, `imagePullPolicy: Always`, manual build+push.
- GPU node k3s-node4 exists (RTX 3080 Ti, 1 free time-slice slot) but AI stays on the gaming
  PC per user direction.

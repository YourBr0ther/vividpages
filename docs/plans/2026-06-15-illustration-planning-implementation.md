# Illustration Planning — Implementation Plan

> Design: `docs/plans/2026-06-15-illustration-planning-design.md` (read first).
> Branch: `feature/illustration-planning`. Execute subagent-driven (implement →
> spec review → quality review → fix). TDD for pure logic. Commit per task,
> trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

Current code map (orientation):
- `packages/db/src/schema.ts` — Drizzle schema; `images.subjectId` (storyboards
  currently = sceneId), `chapters`, `scenes`, `characters`.
- `packages/core/src/pipeline/imagine.ts` — current imagine stage (1 image/scene),
  `loadAnalyzedScenes`, `loadSceneCasts`, hardened retry/systemic logic.
- `packages/core/src/imaging/prompt.ts` — `buildScenePrompt`, `buildPortraitPrompt`.
- `packages/core/src/analysis/{schema,prompt}.ts`, `pipeline/analyze.ts`,
  `pipeline/llm.ts` (`resolveLlm`/`resolveEmbedder`/`resolveImageGen`), `structured.ts`
  pattern in `@vividpages/ai`.
- `apps/web/app/api/books/[id]/content/route.ts` — chapter content + per-scene image.
- `apps/web/components/reader/{reader,scene-block}.tsx`, `lib/reader-types.ts`.

---

## Task 1: `illustration_points` table + migration
**Files:** `packages/db/src/schema.ts`, new migration in `packages/db/drizzle/`.
- Table `illustration_points`: `id` uuid pk default random; `bookId` uuid FK→books cascade;
  `chapterId` uuid FK→chapters cascade; `idx` int; `charOffset` int; `anchorQuote` text;
  `momentDescription` text; `presentCharacterIds` uuid[] default '{}'; `score` real;
  `createdAt`/`updatedAt` timestamptz now. Index `(chapterId, idx)` unique; index `(bookId)`.
  Export an inferred type.
- `pnpm -F @vividpages/db db:generate` → inspect SQL → `db:migrate` against compose PG → verify `\d illustration_points`.
- Commit `feat(db): illustration_points table`.

## Task 2: Core pure logic (STRICT TDD)
**Files:** `packages/core/src/illustration/exclude.ts`, `count.ts`, `locate.ts`,
`plan-schema.ts`, `plan-prompt.ts` + tests.
- `isNonNarrative(chapter: {title, wordCount, skipReason?}): boolean` — word floor (<250),
  title/position regexes (copyright|dedication|acknowledge?ments?|contents|table of contents|
  about the author|^by\s|prologue? NO — prologue IS narrative; be careful), parser skip-reason
  hints. Tests: real-book idx 0 (34w untitled) → true; idx 62 ("Star Bringer, by Tracy...") → true;
  "Prologue" (5796w) → false; "Chapter 2" → false; a 1000w "Dedication" → true.
- `imagesPerChapter(wordCount: number): number` = clamp(round(words/800), 1, 8). Tests: 34→1 (but
  excluded upstream), 1577→2, 5796→7, 12000→8 (cap), 400→1 (floor).
- `locateQuote(text: string, quote: string): number | null` — exact indexOf → normalized-whitespace
  match (collapse runs, case-insensitive) → null. Returns char offset of the containing paragraph
  start (snap to nearest `\n\n` boundary at or before the match). Tests: exact; whitespace variant;
  not-found → null; snaps to paragraph start.
- `plan-schema.ts`: Zod `ChapterPlan { isNarrative: boolean, moments: [{anchorQuote: string,
  description: string, characters: string[], importance: number 1-5}] }` with moments.max(8).
- `plan-prompt.ts`: `buildIllustrationPlanPrompt({chapterText, roster, maxMoments, bookTitle})` →
  {system, prompt}. Tests: maxMoments embedded; roster lines present; "verbatim sentence" +
  "spread across the chapter" + "narrative content" instructions present; chapter text fenced;
  truncate very long chapters (>~28k chars) middle with marker.
- Commit `feat(core): illustration planning pure logic`.

## Task 3: `planChapterIllustrations`
**Files:** `packages/core/src/illustration/plan.ts` + integration test (env-gated OLLAMA_URL).
- `planChapterIllustrations({chapter, roster, maxMoments, llm}): Promise<PlannedPoint[]>`:
  `completeStructured(ChapterPlan)` → if `!isNarrative` return []; else map each moment:
  `locateQuote` → drop unresolved; resolve `characters` to roster character ids (reuse
  `characters/roster.ts` normalization); keep top `maxMoments` by importance; sort by charOffset;
  assign `idx`. Returns points WITHOUT writing DB (caller persists). Accumulate tokens (return them).
- Integration test: real chapter text + a toy roster vs live Ollama → returns ≥1 resolvable point
  with a valid in-range offset; isNarrative true.
- Commit `feat(core): chapter illustration planner`.

## Task 4: Imagine stage refactor (Phase 0 plan → Phase 1 generate)
**Files:** `packages/core/src/pipeline/imagine.ts`, maybe `pipeline/llm.ts` (resolveLlm already exists).
- Phase 0: load chapters; for each, if `isNonNarrative` skip; else `planChapterIllustrations`
  (resolveLlm for the book) → upsert `illustration_points` for the chapter (delete existing points
  for the book first for idempotent rebuild). Progress 'Planning illustrations (ch X/N)'. Accumulate
  tokens via incrementRunTokens.
- Phase 1: generate one storyboard per illustration point (replaces per-scene loop). For each point:
  build prompt via `buildScenePrompt` with `momentDescription` as key moment, `presentCharacterIds`
  → character rows → appearance tokens, and setting/mood from the scene whose [startOffset,endOffset]
  contains `charOffset` (fallback: chapter's first analyzed scene). `images.subjectId` = point id.
  Keep portraits exactly as today. Keep the hardened transient-retry + consecutive-systemic abort +
  resume-skip (skip points that already have a done image of same subject unless `only`/force).
- `only`-mode (single regenerate) still works: `only.subjectId` is now an illustration point id;
  look it up, regenerate version+1.
- Idempotent full rebuild: delete book's existing scene_storyboard images (rows + MinIO objects) and
  illustration_points before re-planning when not in only-mode. (Or: plan is delete-then-insert;
  generation skips done — but since points are rebuilt, old images orphan; clean them.) Document the
  chosen rebuild semantics clearly.
- Commit `feat(core): imagine stage plans illustration points`.

## Task 5: Content API + reader placement
**Files:** `apps/web/app/api/books/[id]/content/route.ts`, `lib/reader-types.ts`,
`lib/queries.ts`, `components/reader/{reader,scene-block}.tsx`.
- Content chapter mode: return `illustrationPoints: [{imageId, charOffset, width, height, version}]`
  for the chapter (latest done storyboard per point), replacing the per-scene `image`. Grouped query,
  no N+1.
- Reader: render each scene's paragraphs, and insert an image plate at any point whose `charOffset`
  falls within that scene's [startOffset,endOffset], between the appropriate paragraphs (split on the
  nearest paragraph boundary ≤ charOffset). Reuse the existing `SceneArt` plate + lightbox; the plate
  now keys on imageId from the point. No image points in a chapter → clean text. Keep fade-in, aspect
  reservation, theme frame, click→lightbox.
- e2e must stay green (art-less book → no points).
- Commit `feat(web): reader places illustrations at chapter offsets`.

## Task 6: Live re-illustration + verify
- Re-illustrate the dev book (trigger imagine; worker + ComfyUI live). Verify in psql + screenshots:
  idx 0 and idx 62 have ZERO illustration_points + images; "Prologue" has ~7 points spread across
  offsets; "Chapter 2" (1577w, single scene) now has ~2 points at different offsets; counts ≈ words/800.
  Reader shows art distributed through a long chapter. Screenshot `docs/screenshots/illustration-spread.png`.
- Full green sweep: `pnpm -r exec tsc --noEmit`, `pnpm -r test`, `pnpm -F web build`, `pnpm e2e`.

## Risks
- LLM anchor quotes may not match chapter text verbatim (paraphrase) → `locateQuote` null → fewer
  points than N. Mitigate: prompt hard-insists verbatim; normalized fallback; accept N as a cap not a floor.
- Re-illustration cost: ~63 planning calls + ~150–200 images on the dev book (~30–45 min). Use the
  monitor pattern; the imagine hardening already tolerates ComfyUI blips.

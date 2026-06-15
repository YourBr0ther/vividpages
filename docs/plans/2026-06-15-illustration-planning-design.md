# Illustration Planning — Design

**Date:** 2026-06-15
**Status:** Approved
**Feature:** Control how many images a chapter gets, exclude non-story pages, and
distribute images sensibly throughout each chapter.

## Problem

Today images are generated **one per analyzed scene**, placed at the scene
boundary. Consequences:
- Count is an accident of word-count segmentation, not a deliberate policy.
- Non-story pages get illustrated (the dev book's idx 0 — a 34-word content
  advisory — and idx 62 — a 221-word "Star Bringer" promo — both got images).
- A long single-scene chapter gets exactly one image at its top, never
  "throughout."

## Decisions (user-confirmed)

| Question | Choice |
|---|---|
| What drives image count | Content-driven: LLM picks the best N visual moments |
| Where candidates come from | A new per-chapter illustration LLM pass, anchored to quotes |
| Exclusion | Heuristic pre-filter + LLM `isNarrative` confirmation |
| Density | Balanced: N = clamp(round(wordCount / 800), 1, 8) |

## Architecture

A new **illustration-planning** step runs as **Phase 0 of the existing `imagine`
stage** (no new queue — reuses imagine's run/progress/fence; planning needs the
LLM, generation needs ComfyUI, imagine already resolves both).

Flow per book:
1. **Filter** — `isNonNarrative(chapter)` skips obvious non-story pages before any
   LLM call: word count < ~250, or title/position patterns (copyright,
   dedication, acknowledgements, contents, "by <Author>", about-the-author), or
   the EPUB parser's skip-reason hints. Skipped chapters stay readable, get no
   images.
2. **Plan** — one LLM call per surviving chapter → `{ isNarrative, moments[] }`.
   `isNarrative:false` ⇒ zero moments. Else up to `N = clamp(round(words/800),1,8)`
   ranked, quote-anchored moments.
3. **Generate** — one image per planned moment, placed at the moment's offset,
   plus the existing character portraits (unchanged).

`analyze` is unchanged and still produces the cast, settings, moods, and per-scene
summaries — these feed the planning pass and the image prompts. **Scenes remain
the analysis unit; illustration points become the image unit**, decoupled from
scene boundaries so long chapters get art throughout.

## Data model

New table **`illustration_points`** (planning output, one row per moment):
- `id`, `bookId` FK cascade, `chapterId` FK cascade, `idx` (order within chapter)
- `charOffset` int — paragraph offset into `chapters.text` for inline placement
- `anchorQuote` text — verbatim sentence the LLM keyed on (locates offset; debug)
- `momentDescription` text — visual description fed to the prompt
- `presentCharacterIds` uuid[] — cast for the prompt's appearance tokens
- `score` real — LLM importance rank (top-N + future tuning)
- timestamps; index `(chapterId, idx)`, index `(bookId)`

`images`: for storyboards, `subjectId` now references `illustration_points.id`
(was `scenes.id`). `kind` stays `scene_storyboard` (opaque tag, avoid churn).
Migration adds the table only; no destructive change to `images`.

## LLM planning contract

Inputs: whole chapter text, cast roster (canonical names + one-line descriptions),
`maxMoments = N`. Zod-validated (same `completeStructured` repair-retry as analyze):

```
{
  isNarrative: boolean,
  moments: [{
    anchorQuote: string,   // verbatim chapter sentence, ≤~120 chars
    description: string,   // one filmable sentence
    characters: string[],  // names present, resolved to roster
    importance: 1–5
  }]                       // ≤ N
}
```

Prompt: pick the most visually distinct, *spreadable* beats (different points in
the chapter, not clustered); prefer concrete action/setting/character over
dialogue-only; anchor each to a verbatim sentence. Map `anchorQuote → charOffset`
(exact match → normalized-whitespace → null/skip), sort points by offset for
placement, keep ≤ N by importance.

Image prompts reuse `buildScenePrompt`: `description` as the key moment,
`presentCharacterIds → appearance tokens`, and setting/mood pulled from the scene
that contains the point's offset. Appearance-token consistency unchanged.

## Reader placement

Content API chapter payload returns the chapter's illustration points
(`{imageId, charOffset, width, height, version}`) instead of per-scene images. The
reader inserts each image plate at its `charOffset` **within** the flowing text:
split a scene's paragraphs at offsets that fall inside it, insert the plate
between paragraphs. Unresolved offsets fall back to the nearest paragraph
boundary, never mid-sentence. Non-narrative chapters return no points → clean
text (the existing `image:null` path). `reading_progress`, portraits, lightbox,
regenerate, and version history are unaffected.

## Migration / re-illustration

Migration adds the table. The dev book's 101 scene-keyed storyboards become stale;
re-illustration deletes the book's old `scene_storyboard` images (rows + MinIO
objects), plans fresh points, and generates. Portraits are kept.

## Build order

1. Data model — `illustration_points` + migration, applied.
2. Core (TDD): `isNonNarrative`, `imagesPerChapter(words)`, `locateQuote`,
   planning prompt builder + Zod schema.
3. `planChapterIllustrations(chapter, roster, N, llm)` → writes points.
4. Imagine refactor — Phase 0 plan (skip non-narrative, idempotent), Phase 1
   generate per point; prompts use containing scene's setting/mood; resume-safe.
5. Content API + reader placement at offsets.
6. Live re-illustrate the dev book; verify idx 0 / idx 62 get zero images, long
   chapters get spread-out art, counts ≈ words/800; screenshots.

## Testing

Unit for all core logic; env-gated integration of the planning call vs live
Ollama; existing Playwright e2e stays green (art-less book = no-points path);
final live eyeball of distribution + exclusion on the real book.

## Out of scope (YAGNI)

Per-book density setting (fixed Balanced default; trivial to expose later).
Renaming the `scene_storyboard` image kind.

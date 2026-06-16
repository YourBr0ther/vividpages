# Main/Minor Character Roles — Design

**Date:** 2026-06-16
**Status:** Approved

## Problem

The 4-way role (protagonist/antagonist/supporting/minor) models *narrative
function*, which the only strong signal we have (scene frequency) can't compute —
frequency measures importance, not protagonist-vs-antagonist. Symptoms on the dev
book: the 40%-scene floor mechanically produced "two protagonists", and a
high-frequency antagonist would be force-promoted to protagonist unless the noisy
small LLM happened to tag it. Protag/antag was only ever used for cosmetic gallery
grouping; the functionally meaningful distinction is "important enough for a
portrait."

## Decision

Collapse the role to **`main` | `minor`** — aligns the category with the signal we
have and drops the dimension we can't compute reliably.

| Question | Choice |
|---|---|
| How decided | LLM "main or minor" judgment **+ deterministic scene-share floor** |
| Floor | scene-share ≥ **MAIN_SCENE_RATIO = 0.12** → forced `main` (tunable) |

## Classification

- **Profiles prompt:** ask "main or minor" (drop protagonist/antagonist/supporting):
  *main* = central or recurring character the reader follows; *minor* = a scene or
  two. Scene-count remains the strongest hint.
- **`clampMainMinor(role, sceneCount, totalScenes)`:** if `sceneCount/totalScenes ≥
  MAIN_SCENE_RATIO` → `'main'` (frequency floor, raises a mislabeled minor); else
  the LLM's call stands. Replaces `clampRole` (no more LEAD/SUPPORTING ratios,
  no antagonist exception).

## Downstream

- **Portrait eligibility:** `main` → portrait; `minor` → skipped (was
  protagonist/antagonist/supporting). `PORTRAIT_ROLES` → `{ 'main' }`. LoRA/scene
  logic unaffected.
- **Cast gallery:** two sections — "Main cast" and "Minor characters" (minor stays
  behind the existing disclosure). Role badge simplifies (a "main" tint or just the
  section header).
- **Schema:** `CharacterProfile.role` enum → `['main','minor']`; `characters.role`
  stays `text`.

## Migration

One SQL remap of existing data, no re-analysis:
`protagonist|antagonist|supporting → 'main'`, `minor → 'minor'`. The current book's
cast reclassifies instantly; nothing regenerates.

## Build plan (worktree `feature/main-minor-roles`, TDD)

1. `CharacterProfile.role` zod → `['main','minor']`; update the profiles prompt.
2. `clampMainMinor` (TDD: ≥12% → main both when LLM said minor and when it said
   main; <12% keeps the LLM call; totalScenes=0 guard).
3. Migration remapping existing `characters.role` values.
4. `PORTRAIT_ROLES` → `{ 'main' }` (imagine portrait selection).
5. Cast gallery: two-section grouping + badge update.
6. Repo-wide type/test updates for the enum change.

## Testing

TDD `clampMainMinor`; profiles + imagine portrait-selection tests updated; cast
page renders two sections; e2e green; tsc/build clean. Migration applied + verified
(existing roles remap). No live re-analysis needed.

## Out of scope (YAGNI)

Re-introducing narrative-function labels; per-book threshold; re-running analysis
to recompute roles (the remap + future runs cover it).

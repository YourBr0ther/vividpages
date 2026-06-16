# Character Merge (combine duplicates) — Design

**Date:** 2026-06-16
**Status:** Approved

## Problem

Automated dedup (name/alias + embedding + LLM reconciliation, in the profiles
stage) can't reliably connect a personal name to a role-epithet — e.g. "Trystan"
and "The Villain" are the same person but stayed two character rows, which also
made the role classification self-contradict (Trystan=protagonist,
The Villain=antagonist). That class of miss is inherent. We need a reliable way to
**combine duplicate characters**, plus a modest improvement to the automated pass.

## Decisions (user-confirmed)

| Question | Choice |
|---|---|
| Approach | **Both** — manual merge UI (reliable) + stronger automated reconciliation |
| Survivorship | Pick a **primary**; it keeps everything (profile, portrait, appearanceToken, role, LoRA). Absorbed contributes scene appearances + its name as an alias. |
| Post-merge images | **Auto-regenerate** the affected scenes (the absorbed character's scenes), in the background |

## Merge mechanics (core `mergeCharacters`, transactional)

Extend the existing internal helper (reused by API + dedup passes). In one tx:
- Move `scene_characters` absorbed → primary (existing PK-conflict handling); recount `sceneCount`.
- Aliases = primary ∪ absorbed ∪ absorbed.name.
- **illustration_points**: remap `presentCharacterIds` (absorbed id → primary id, dedupe). The set of points changed = the affected scenes.
- Delete absorbed's `character_portrait` image rows + MinIO objects (primary keeps its own portrait).
- Primary keeps profile / appearanceToken / role / LoRA fields / embedding. Delete absorbed row.
- Return the affected illustration-point ids.

The user picks as **primary** whichever record holds the data worth keeping (make
"The Villain" primary if it has the richer profile + portrait, absorbing "Trystan").

## Auto-regen

After the merge commits, enqueue a **targeted imagine regen** for the affected
points: extend the imagine `only` payload from one subject to a set
(`only: { kind: 'scene_storyboard', subjectIds: [...] }`), reusing run-stamping +
the #4 bounded-concurrency runner. New image versions depict the merged identity
(primary name + appearance token). Progress via the existing SSE/jobs dashboard.
Best-effort + resumable: if nothing affected or the worker/ComfyUI is down, the
merge still succeeds. The primary's own portrait is left as-is (identity unchanged).

## API

`POST /api/books/[id]/characters/merge { keepId, absorbId }` — auth + ownership
(both characters in the book; book owned by user; ids distinct/valid). Runs the
merge, inserts a `pipeline_run`, enqueues the targeted regen. Returns
`{ character, regenerating }`. **Fence:** if a run is already active on the book,
the data merge still completes but auto-regen is skipped with a "regenerate
manually — a run is in progress" note (no collision with the one-running-run index).

## UI

Cast page: each character card gets a "Merge into…" action → choose the primary
target among the other characters → confirm dialog: *"Absorb {absorb} into
{primary}; {absorb}'s portrait is dropped and its scenes will re-illustrate."* On
confirm → POST → affected scenes regenerate in the background (watchable in Jobs).

## Automated reconciliation improvement

Strengthen the profiles-stage LLM reconciliation pass to explicitly consider
**personal-name ↔ title/epithet identity** ("Trystan" = "The Villain") using book
context, while keeping the confidence gate (manual merge is the backstop, so stay
conservative — over-merging distinct people is worse than a miss).

## Build plan (worktree `feature/character-merge`, TDD, subagent-driven)

1. Extend core `mergeCharacters`: illustration_points remap + absorbed-portrait
   deletion + return affected points. TDD pure alias-merge + presentCharacterIds remap/dedupe.
2. Extend imagine `only` → set-of-points regen. TDD the work-plan from an only-set.
3. Merge API (auth/ownership/validation + fenced regen enqueue).
4. Cast UI merge action + confirm + progress.
5. Reconciliation prompt improvement (profiles stage).

## Testing

TDD pure merge + only-set work-plan; e2e green; tsc/build clean. **Live smoke:**
merge Trystan/The Villain on the dev book — confirm rows combine, points remap,
affected scenes regenerate (jobs dashboard), screenshot the unified cast.

## Out of scope (YAGNI)

Split (un-merge); multi-absorb in one action (merge two at a time; repeat);
field-by-field survivorship; regenerating the primary's unchanged portrait.

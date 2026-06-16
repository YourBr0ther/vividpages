# Mature-Content Fidelity — Design

**Date:** 2026-06-15
**Status:** Approved
**Issue:** #3 — faithful rendering of mature/NSFW scenes (don't sanitize the source)

## Goal

VividPages is a self-hosted, single-owner reader for legally-obtained books
(the README already flags 18+/adult content). When a book contains mature
material (intimacy, sexuality, violence), the pipeline should depict **what
actually happens** rather than euphemizing, omitting, or fading to black —
gated behind an explicit opt-in setting, default off.

## Decisions (user-confirmed)

| Question | Choice |
|---|---|
| Setting scope | Per-book boolean + a per-user default that pre-fills new uploads |
| Granularity | On/off boolean (the book's own content sets the ceiling) |
| Re-process semantics | Affects all 3 LLM stages; toggling on an existing book is applied by re-running analysis → planning → imagine |
| Provider | Reuses the book's configured provider; **realistically effective only with local/self-controlled models** (cloud LLMs/DALL·E will refuse) |

## Data model

Two boolean columns (mirrors the existing provider-settings pattern):
- `user_settings.matureContentDefault boolean not null default false` — pre-fills new uploads.
- `books.matureContent boolean not null default false` — effective per-book flag, seeded from the user default at upload, overridable in book settings.

Read at stage time from `book.matureContent`; not copied onto `pipeline_runs`.

## Flow

A single `mature: boolean` parameter threads into the three prompt builders:
- **`analysis/prompt.ts`** — when `mature`, instruct the model to summarize what
  actually occurs (including intimate/sexual/violent content) plainly, without
  euphemism or omission, and to treat such beats as legitimate content.
- **`illustration/plan-prompt.ts`** — when `mature`, mature beats are valid (often
  the most important) visual moments; don't skip them. ("Prefer concrete action"
  stays; intimacy/violence counts as concrete action.)
- **`imaging/prompt.ts`** — when `mature`, render the moment faithfully (still
  ending with the technical "no text/watermark" clause).

When `mature` is off, **every builder's output is byte-identical to today.**

Pipeline stages (`analyze`, and the planning + image phases of `imagine`) read
`book.matureContent` and pass it down. No new provider/model wiring.

## Provider reality (explicit, non-negotiable)

Cloud LLMs (Claude, OpenAI) and DALL·E **will refuse** explicit content under
their usage policies. So the setting is realistically effective only with **local
models**: the user's Ollama LLM (can point at an uncensored model) and ComfyUI
(Z-Image Turbo is fairly permissive; an uncensored checkpoint/LoRA via #2 is the
real lever). We do **not** attempt to evade any provider's safety — we send honest
instructions and let the configured model respond.

Handling refusals:
- The pipeline already tolerates per-scene LLM failures (marks scene failed,
  continues) — a cloud refusal degrades gracefully, never crashes.
- Settings + book UI show a plain note when `mature` is on while a cloud provider
  is selected: *"Cloud providers may refuse mature content; use a local model for
  faithful results."*

## UI (reuses existing surfaces)

- **Settings page:** "Mature content — faithful depiction" toggle (`matureContentDefault`) + cloud note.
- **Upload:** `book.matureContent` seeded from the user default; no extra step.
- **Book detail:** per-book toggle; helper text *"Re-run analysis to apply to this
  book's existing scenes."* The existing pipeline controls (Run analysis → re-plan
  → re-illustrate) perform the all-3-stages re-process — no new endpoints.

## Build plan (worktree `feature/mature-fidelity`, TDD, subagent-driven)

1. Schema: the two boolean columns + migration.
2. Thread `mature` into the three prompt builders (TDD: on adds the fidelity
   instruction; **off byte-identical to current**).
3. Pipeline stages read `book.matureContent`, pass it through.
4. Upload seeds `matureContent` from the user default; settings + book-settings
   APIs read/write the flags.
5. UI toggles + cloud-provider note.

## Testing

Unit-test the prompt builders (on/off), the flag flow, and the settings APIs.
e2e stays green (default off → no behavior change). tsc/build clean.
**No live mature generation is run by the assistant** — plumbing is verified via
tests; faithful image/text output is the owner's to validate on local models.

## Out of scope (YAGNI)

Graduated levels (off/suggestive/explicit); per-provider auto-switching; bundling
an uncensored model (the user supplies that). Relates to #2 (uncensored LoRA is
the model-side lever) and #1 (prompt fidelity).

# Per-Character LoRA — Design

**Date:** 2026-06-15
**Status:** Approved
**Issue:** #2 — per-character LoRA support (optional trigger keyword + strength)

## Goal

Optionally attach a LoRA to a character to lock its likeness/style, applied to
that character's portrait and any scene they appear in. **Fully optional** — a
character without a LoRA generates exactly as today; zero LoRA-configured
characters means the workflow and prompts are byte-identical to current.

## Environment (verified)

ComfyUI at `http://10.0.2.192:8000` is up with **43 LoRAs** installed, including
Z-Image-Turbo-compatible ones (`*IZT*`, `*Z-Image-Turbo*`) and character/style
LoRAs. `LoraLoader` inputs: `model, clip, lora_name, strength_model, strength_clip`.

## Decisions (user-confirmed)

| Question | Choice |
|---|---|
| LoRA selection | Dropdown from ComfyUI (`/object_info/LoraLoader`), free-text fallback when unreachable |
| Strength | Single `strength` (0–1.5, default 1.0 per Z-Image guidance) applied to both model+clip |
| Keyword placement | Woven into the character's subject phrase (Z-Image-aligned + multi-character-correct); optional |
| Optionality | Hard requirement — no LoRA = unchanged behavior everywhere |

Z-Image LoRA guidance: trigger word near the start / woven with the subject (e.g.
"kariiina with red hair…"), strength ~1.0. Subject-adjacent placement satisfies
both that and correct binding in multi-character scenes.

## Data model

Three nullable columns on `characters` (null = no LoRA = today's behavior):
- `loraName text` — ComfyUI LoRA filename (null = none; the on/off switch).
- `loraKeyword text` — optional trigger word (null/empty → inject nothing).
- `loraStrength real default 1.0` — applied to both `strength_model`/`strength_clip`.

A character is LoRA-enabled only when `loraName` is set.

## LoRA discovery

`GET /api/loras` (auth) proxies ComfyUI `/object_info/LoraLoader` →
`{ loras: string[], available: boolean }` against the book/user/env ComfyUI URL,
short timeout. On failure → `{ loras: [], available: false }` so the UI falls back
to a free-text field.

## Workflow & adapter (graph surgery only when LoRAs requested)

Static `zimage-t2i.json` unchanged. `ComfyUIImageGen.generate` gains
`loras?: Array<{ name; strengthModel; strengthClip }>`:
- Non-empty → insert N `LoraLoader` nodes (fresh ids), chained
  `checkpoint.MODEL/CLIP → lora₁ → … → loraₙ`; repoint the KSampler `model` input
  and BOTH CLIPTextEncode `clip` inputs to the last loader. Node-title lookup
  (same robust approach the adapter already uses).
- Empty/absent → graph untouched, byte-identical to today.

## Imagine stage

Per work item, assemble the LoRA list:
- Portrait: the one character's LoRA if `loraName` set.
- Scene: present cast's LoRAs (only `loraName`-set), deduped by name, **capped at
  `SCENE_CAST_LIMIT` (3)** — stacking more degrades quality/VRAM; a dropped 4th is
  still described in the prompt (logged).
- Same LoRA across characters → one loader. Record chosen LoRAs (name+strength) in
  the image row's `params`.
- Zero LoRA-configured present characters → no surgery, unchanged.

## Prompt (keyword weaving)

`CharacterForPrompt` gains optional `loraKeyword`. When set, weave into the
subject phrase: portrait "{keyword}, {name}, {appearance}…"; scene cast
"{keyword} {name} ({appearance})". Blank/absent → byte-identical to today.

## UI

Cast-page character cards get an optional "Character LoRA" config: dropdown from
`/api/loras` (free-text fallback), optional keyword field, strength input
(0–1.5, default 1.0). Saved via `PATCH /api/characters/[id]` (auth + ownership via
the book). "None" clears it. Helper: applies on next portrait/scene regeneration.

## Build plan (worktree `feature/character-lora`, TDD, subagent-driven)

1. Schema: 3 nullable character columns + migration.
2. `GET /api/loras` discovery (proxy + timeout + fallback).
3. Adapter: `loras` option + LoraLoader-chain graph surgery — TDD as pure logic.
4. Prompt builder: keyword weaving — TDD (present woven; absent byte-identical).
5. Imagine: per-item LoRA assembly + keyword passthrough + params provenance.
6. `PATCH /api/characters/[id]`.
7. Cast UI: per-character LoRA config.

## Testing

Unit-test the graph surgery (insert/rewire; empty→identical), keyword weaving
(on/off), and LoRA-list assembly (dedupe, cap). **One live smoke test** on a safe
Z-Image *style* LoRA (e.g. `CharacterDesign-IZT-V1`) — NOT the person/"OF" LoRAs:
bind a character, regenerate its portrait, confirm it generates with the LoRA and
`params` records it. e2e green, tsc/build clean. No-LoRA path byte-identical.

## Out of scope (YAGNI)

Separate model/clip strengths; LoRA training; auto-suggesting LoRAs; >3 stacked
LoRAs per scene. Relates to #1 (prompt fidelity) — keyword weaving extends the
natural-language prompt; carry the #1-review 25-word per-character description cap
note here (ensure LoRA keyword + description survive length pressure sensibly).

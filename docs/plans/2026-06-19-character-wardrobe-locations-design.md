# Character Wardrobe + Location Consistency (+ Upload Wizard, Auto-Run) — Design

**Date:** 2026-06-19
**Status:** Approved

## Problem

Characters drift across generations — body type (build, bust, hair) changes
scene to scene, and clothing isn't tracked, so the same character appears in
different outfits at random. Locations also re-render inconsistently. We need to
track, per character, what they look like (immutable body) and what they're
wearing (per scene), plus a consistent set of locations — and use all of it to
prompt. Separately, the current flow forces the user to click "analyze" and then
later "generate art"; they want one upfront wizard, then a hands-off run to
finished art.

## Decisions (confirmed)

| Question | Decision |
|---|---|
| Consistency engine | **Structured text** (body model + per-state descriptors reused verbatim). LoRAs are **second-class** — used when present (~2% of cases), not required. Reference images are QA/reference only (Z-Image has no IP-Adapter; img2img parked). |
| Population | **Fully automatic** extraction from the book (no editing UI). |
| Scope | **Main characters** get the full wardrobe; **minors** get body + base outfit with a per-character **"upgrade to full wardrobe"** toggle. |
| Mature gating | Upload **wizard** asks mature?; non-mature → outfits only (no underwear/nude). Mature → adds underwear + nude. |
| Orchestration | Wizard collects **all** choices up front; completing it runs the **entire pipeline to finished art**, auto-chained, no manual gates. |

## Section 1 — Domain model

Per character, appearance splits into two layers:

- **Body model** (immutable identity — the consistency anchor): build, height,
  figure/bust, hair, skin, eyes, distinguishing marks. One per character, woven
  **verbatim** into every generation of that character regardless of outfit.
- **Wardrobe states** (clothing on the body model):
  - **base outfit** — default/most-frequent look
  - **additional outfits** — other distinct outfits described in the book
  - **underwear** — derived from the body model *(mature only)*
  - **nude** — body model, no clothing *(mature only)*

  Each state = a structured text descriptor **+** a generated reference image.

- **Eligibility:** mains get the full set; minors get body + base, upgradeable.
- **Mature gating:** book-level flag (set in the wizard) decides whether
  underwear/nude states exist at all.

**Locations** are a parallel book-level registry: named places extracted from
the text, each with a visual descriptor (+ optional reference image), so
recurring rooms look the same and scenes carry grounded setting context.

## Section 2 — End-to-end flow (wizard → it just runs)

1. **Upload** → wizard launches.
2. **Wizard** collects every up-front choice in one pass: **mature?** (gates
   underwear/nude), style preset, any other pre-gen choice. No mid-pipeline questions.
3. **Finish** → one action enqueues the pipeline, which **auto-chains to completion**:

   `ingest → segment → analyze → profiles (+ body-model & wardrobe extraction + location registry) → illustration planning (+ per-scene state/location assignment) → reference-model generation (mains/upgraded) → imagine (scene art)`

   Each stage enqueues the next on success — including the analyze→art handoff
   that is manual today. Both current manual gates disappear.
4. **Progress** on the book/jobs dashboard; the user returns whenever. A failure
   pauses that book (visible), never silently stops.

## Section 3 — Extraction + scene-mapping (automatic)

Reuses the analyze/profiles LLM patterns.

**A. Build registries (rides with profiles):**
- **Body model** — extend profile extraction to lock immutable traits into one canonical descriptor.
- **Outfits** — capture each distinct described outfit as scenes are analyzed, then **consolidate + dedup** across the book into a per-character set (same mechanism as existing character dedup/reconciliation). Most-frequent = **base**; rest = **additional**.
- **Locations** — same collect-then-dedup into a book-level registry.
- **Underwear / nude** (mature only) — *derived*, not extracted: default undergarment set + bare body model.

**B. Per-scene assignment (during illustration planning, per point):**
- For each present character: **which state** here? The LLM picks from that
  character's **enumerated** states (constrained choice — far more reliable on
  the small local model, same lesson as the main/minor clamp). Defaults to
  **base** when unsignaled; underwear/nude only offered on mature books.
- **Which location** — map to a registry location, else fall back to `scene.setting`.

The chosen state's descriptor + body model + location descriptor are woven
verbatim into that scene's prompt.

## Section 4 — Reference models + prompt integration

**Reference model images:** for each eligible character × state, generate one
portrait-style render (body model + state descriptor) in the existing neutral
studio framing (reuse `buildPortraitPrompt` + portrait path). Stored like
portraits (MinIO + `images` row keyed to the state), shown on the cast page. New
"reference-model generation" stage, bounded-concurrency runner. **Reference/QA
only — not fed into scene generation** (no IP-Adapter); the reused text is the
consistency engine.

**Prompt integration** (`buildScenePrompt` / `renderCharacterDescription`): each
present character's description = **body model (verbatim, always) + the
scene-assigned state's outfit descriptor (verbatim)**. Nude state = body model +
explicit bare descriptor (mature only). The scene's mapped **location
descriptor** feeds the setting clause. Everything recently shipped stays:
count-aware framing (`framingFor`), position hints, LoRA keyword when present,
mature-fidelity instruction, director ordering, length management.

Net: consistent **body** + correct **per-scene outfit** + consistent **location**,
all from reused structured text.

## Section 5 — UI + data model

**Cast page:** each character expands to a wardrobe sheet — body-model summary +
state tiles (Base, Additional…, Underwear, Nude — last two mature-only), each
with reference image + descriptor. Minors show body + base with an **"Upgrade to
full wardrobe"** button. A book-level **Locations** gallery alongside.

**Wizard:** short multi-step dialog on upload — mature? + style preset → Finish
enqueues the auto-chained run.

**Data model (additive Drizzle migrations):**
- `character_appearance_states` (character_id, type `base|additional|underwear|nude`, descriptor, image object key)
- `locations` (book_id, name, descriptor, image object key)
- body-model fields on the character (`profile` JSONB or columns) + `wardrobeUpgraded` flag
- `illustration_points`: per-character state map (characterId→stateId) + `location_id`
- `books.matureContent` already exists — wizard sets it

## Build order (phased; nothing dropped)

1. **Wizard + full auto-chaining** — the workflow win; independent, high-value.
2. **Body model + base/additional outfits** — extraction→consolidation,
   per-scene outfit assignment, prompt integration, cast-page sheet, outfit
   reference models.
3. **Locations** — registry, scene mapping, setting-clause integration.
4. **Mature states** (underwear/nude) + mature gating + minor upgrade.

## De-risk / testing

- **Riskiest part: extraction quality** on the small local LLM (body model,
  outfit consolidation, per-scene state inference). Before wiring the full
  pipeline, **spike the extraction on the dev book** and eyeball whether
  outfits/body/locations and per-scene assignment come out sane.
- TDD the pure functions: state selection, outfit consolidation/dedup, prompt
  composition.
- Migrations applied to dev + verified; e2e green; tsc/build clean.

## Extraction spike findings (2026-06-19) — model + mandatory scaffolding

Two throwaway spikes ran the extraction probes against the dev book via the real
`completeStructured` path (`llama3.1:8b` then `qwen2.5:14b`, both on the box).

**Model decision: use `qwen2.5:14b`** for the wardrobe/body/location stage, not
`llama3.1:8b`. 14b is strictly better where 8b broke: single-base discipline (8b
double-based a character; 14b 3/3 correct), per-scene state pick under a hard
`z.enum` (**100% in-list, 0 repair activations** on 14b), and it didn't
hallucinate locations. Latency ~7–20s/char (outfit pass) / ~1s (per-scene) — fine
for an offline batch stage.

**Per-probe verdicts:**
- **Body model — GOOD.** Compose the descriptor deterministically from the
  structured fields and strip clothing (the LLM leaks attire into the
  "immutable" descriptor otherwise). Respects nulls; no hallucination.
- **Per-scene state pick — RELIABLE only with a HARD `z.enum`** built per
  character from that character's actual labels + default-`base` fallback.
  Mandatory; loose-string-then-validate is not enough.
- **Location registry — descriptors good, dedup weak.** Single-shot dedup over
  ~80 settings under-merges (3–4× redundancy on key rooms). Needs a two-pass
  reconciliation (extract → separate merge call returning canonical ids), like
  the existing character dedup.
- **Outfit consolidation — the hard problem, NOT a model fix.** Both models
  conflate *transient states* (injuries, "soaked", "tousled", mood, blood/dirt)
  with outfits because the source signal (`description_delta`/`state_changes`)
  is mostly those deltas; 14b made it worse (one "outfit" per injury).

**Mandatory scaffolding for Phase 2/4 (beyond model choice):**
1. **Transient-state signal separation (dominant lever):** deterministically
   strip injuries/mood/dirt/wetness from the clothing signal before the outfit
   LLM call (or route clothing vs transient-state to separate extractors). Data
   fix — no prompt wording solves it.
2. **Hard `z.enum` per character** for per-scene state (`completeStructured`
   repair loop as backstop — barely exercised on 14b).
3. **Single-base clamp** in code (cheap safety net; pick max-mentions).
4. **Dedup-merge** for outfits + **two-pass reconciliation** for locations.
5. **Body-model descriptor composed from fields + clothing-stripped.**

## Out of scope (YAGNI)

Reference images driving generation (img2img/IP-Adapter — Z-Image lacks it);
editing UI for extracted data (population is fully automatic; only the
minor-upgrade toggle and the mature flag are manual); per-garment layering
beyond a single outfit descriptor per state.

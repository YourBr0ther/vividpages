# One-Shot Scene Prompting — Physical Staging + Framing — Design

**Date:** 2026-06-18
**Status:** Approved

## Problem

Scene illustrations sometimes read as generic: characters present and roughly
right, but the *specific physical action* the text describes (kneeling, looming,
embracing, recoiling) isn't always staged, and faces come out small/soft in
wide framings. The original hypothesis was that Z-Image Turbo couldn't ground
multiple characters in a scene and we needed a compositional/ControlNet pipeline
to place them. A day of throwaway spikes disproved that hypothesis.

## What the spikes found (the evidence behind this design)

Run against the live ComfyUI (`z-image-turbo-fp8-aio`), one real 2-character
scene from the dev book ("The Villain confronts Evie"), throwaway scripts:

1. **Empty plate → masked inpaint of each character → harmonize.** Result:
   **cutouts.** Masked inpainting generates inside the mask blind to the room's
   perspective/lighting, so characters float like panels on top of the
   background. No tuning fixes this — it's inherent to region inpainting. ✗
2. **ControlNet (Z-Image Fun Union, pose skeleton) single pass.** Result: a
   character genuinely *grounded* — floor contact, perspective, shared light.
   Works for 1 and 2 characters, and even an intimate embrace (overlapping
   skeletons did not merge). ✓ — **but** see #4.
3. **Draft → Canny edges → ControlNet lock-in.** Result: faithfully preserves
   the draft (whole composition incl. objects). But the *plain one-shot draft*
   it started from was already clean and grounded, for both an office
   confrontation and an intimate embrace. The lock-in only refined it. ≈
4. **Pose-control test — one-shot vs ControlNet, "kneeling."** Result: **both
   knelt.** One-shot obeyed the "kneeling" prompt on its own; ControlNet
   enforced the exact skeleton pose but one-shot wasn't wrong. ≈

**Conclusion:** Z-Image one-shot is far more capable than the premise assumed.
It grounds characters and follows *describable* poses from the prompt. The
ungrounded/melted/cutout failures were artifacts of the wrong *mechanisms*
(inpaint), not weaknesses of one-shot. ControlNet's genuine, irreplaceable value
is **exact pose control** — needed only for a minority of scenes (unusual body
configurations that resist description, or exact reproducibility), not as the
backbone of every illustration.

## Decision

Improve **one-shot** scene generation through prompting. Do **not** build the
ControlNet/compositing pipeline as the backbone. Keep ControlNet documented as a
future, selective escape-hatch (see Out of scope).

## Changes (surgical; no new ComfyUI deps, no schema upheaval)

The scene prompt already leads with each illustration point's `momentDescription`
(`imagine.ts` — the point's planned "filmable sentence" is passed as both
`summary` and `keyVisualMoment` into `buildScenePrompt`). So the wiring is
correct; the levers are the *content* of that sentence and the *framing*.

1. **Make the planned moment physical (primary lever).** Tighten
   `illustration/plan-prompt.ts` so each `description` is concrete *staging* —
   what the bodies are doing, their spatial relationship, the visual action —
   not the topic. "The Villain looms over the desk, jabbing a letter toward Evie
   who stands rigid, arms crossed," not "confronts Evie about the letter."
   Strengthen the instruction in the prompt and add 2–3 few-shot examples. Keep
   the existing `description` field in `plan-schema.ts` (no schema change); a
   dedicated `staging` field is a later option if one sentence proves cramped.

2. **Fix framing so faces aren't tiny.** Every spike at full-body 1024² gave
   small, soft faces. Refine `shotFor`/framing in `imaging/prompt.ts` to factor
   **character count + importance**: 1–2 character emotional/dialogue beats →
   medium / waist-up (bigger faces); reserve wide/establishing for action and
   scene-setting. Pure function — TDD.

3. **(Minor) Position hints for 2+ characters** woven into the prompt
   ("on the left… on the right") — cheap separation aid; shown to help in spikes.

**Unchanged:** appearance tokens (verbatim), LoRA keyword weaving, mature-fidelity
instruction (opt-in), director ordering, `MAX_SCENE_PROMPT_WORDS` length
management, the whole pipeline shape (ingest→segment→analyze→profiles→imagine).

## Out of scope (with spike evidence, for the record)

- **ControlNet pose pipeline** — real value only for the exact-pose minority.
  Proven recipe if we ever want it: ComfyUI Fun Union patch
  `Z-Image-Turbo-Fun-Controlnet-Union-2.1(-lite)` in `models/model_patches/`,
  node `ZImageFunControlnet` (model + model_patch + vae + strength + image) →
  `ModelSamplingAuraFlow` → KSampler; control image from a synthetic OpenPose
  skeleton (renderer drafted in the throwaway `spike-pose.ts`/`spike-controlnet.ts`)
  or DWPose draft-extract (needs `comfyui_controlnet_aux`). Strength 0.8–0.9 for
  pose, ~12 steps.
- **Compositing / masked inpaint** — disproven (cutouts).
- **FreeFuse multi-character LoRA** — shipped upstream (`freefuse`, branch
  `comfyui`, ≥1.0.13; `controlnet_zimage_freefuse_complete.json` combines it with
  ControlNet) but unneeded for the no-LoRA backbone; revisit only if per-character
  *trained-LoRA* identity in multi-character scenes becomes a requirement. Note
  the split-vs-fp8 checkpoint mismatch risk (workflow expects
  `z_image_turbo_bf16` + `qwen_3_4b` + `ae`, not the all-in-one fp8).

## Testing

- TDD the framing/`shotFor` changes and the prompt assembly (pure functions).
- Planning-prompt change validated by re-planning a chapter on the dev book and
  eyeballing that descriptions read as physical staging.
- Live eval: regenerate ~6–8 scenes on the dev book and compare against current
  output (faces larger, action staged). No automated A/B.

## Build plan (worktree `feature/scene-staging`, TDD)

1. `shotFor`/framing by count+importance (+ tests).
2. Position-hint weaving for 2+ characters (+ tests).
3. `plan-prompt.ts` staging instruction + few-shot examples.
4. Live eval on the dev book; tune.

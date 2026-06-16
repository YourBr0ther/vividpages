# Scene Prompting Refinement — Design

**Date:** 2026-06-16
**Status:** Approved
**Builds on:** #1 (Z-Image Turbo prompting)

## Goal

Refine `buildScenePrompt` to match Z-Image Turbo's scene-composition preferences
(deeper than #1's base structure). Straight quality improvement applied to all
scene storyboards — not opt-in. Portraits unchanged.

## Research findings (Z-Image Turbo scene prompting)

- **Order matters: subject → action → setting → mood → camera.** Early tokens
  steer composition. Current builder leads with the *camera* ("A cinematic wide
  shot. {moment}…") — backwards.
- **Vary the shot by content** with real camera vocabulary (close-up / medium /
  full-body / wide / establishing; angles front/45°/profile/low/high). Current
  builder hardcodes "cinematic illustrative wide shot" for every scene.
- **Describe multiple subjects separately** — already done (per-character cast).
- **Lighting is the #1 lever** — already derived from timeOfDay.
- **Cap at 3–5 strong visual concepts** — past that, attention drifts.

Sources: deAPI prompting guide, z-image-turbo.art, zimageturbo.org best practices.

## Changes to `buildScenePrompt` (packages/core/src/imaging/prompt.ts)

1. **Shot-type from `sceneType`** — `shotFor(sceneType)`:
   - dialogue → "a medium two-shot" (or over-the-shoulder)
   - action → "a dynamic wide shot from a low angle"
   - description / transition → "a wide establishing shot"
   - narrative → "a medium-wide shot"
   - null/unknown → "a cinematic wide shot" (current default)
   Thread `sceneType` into the scene context the imagine stage builds
   (`sceneContextForOffset` → add `sceneType` alongside setting/timeOfDay/mood;
   `SceneForPrompt` gains `sceneType`).
2. **Reorder** to: subject/action (keyVisualMoment + cast woven) → setting →
   lighting → mood → shot/camera framing → style → technical clause.
3. **Concept discipline** — keep within ~3–5 strong concepts; existing
   `SCENE_CAST_LIMIT` (3) and length-pressure dropping preserved.

**Must preserve:** appearance tokens verbatim (#1), LoRA keyword weaving (#2),
mature-fidelity instruction when on (#3), determinism, the trailing technical
clause. `mature`/`loraKeyword`/style-preset threading unchanged.

## Build plan (worktree `feature/scene-prompting`, TDD)

1. `shotFor(sceneType)` pure helper + thread `sceneType` through
   `sceneContextForOffset` and `SceneForPrompt`/imagine.
2. Rewrite `buildScenePrompt` ordering + shot framing.
3. TDD: shot mapping per sceneType; new order present; appearance tokens verbatim;
   LoRA keyword still woven to the right character; mature instruction still
   present when on; determinism; null-field fallbacks; portraits untouched.

## Testing

Unit tests as above; e2e green; tsc/build clean. No live A/B (per decision) —
takes effect on next generation.

## Out of scope (YAGNI)

Focal-length / lens hints; per-scene angle randomization; portrait shot changes.

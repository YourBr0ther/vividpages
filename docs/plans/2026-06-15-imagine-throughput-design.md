# Imagine Throughput — Design

**Date:** 2026-06-15
**Status:** Approved
**Issue:** #4 — increase image-generation throughput (single ComfyUI instance)

## Goal

Keep the single ComfyUI instance / GPU saturated during the imagine stage's
generation phase. Today images render one at a time and the GPU sits **idle
~1–2s between each ~6.1s render** while the worker post-processes (sharp webp +
thumb + 2 MinIO uploads + DB write) before submitting the next prompt. No second
ComfyUI instance — on one GPU that wouldn't help (compute contention); the waste
is in our own loop.

## Approach

Replace Phase 1's sequential loop with a **bounded-concurrency runner** (in-flight
depth `N = WORKER_IMAGINE_INFLIGHT`, default 2). Each work item still runs the full
task — `imageGen.generate()` → sharp webp+thumb → MinIO ×2 → `images` insert — but
up to N run concurrently. With N=2, while the GPU renders image A, image B is
already queued in ComfyUI (GPU rolls straight into it) and A's finished sibling
post-processes on our side. ComfyUI serializes GPU execution, so N=2 doesn't
contend for compute — it just removes the round-trip + post-processing idle gaps.

Phase 0 (illustration planning, run-stamped) is unchanged and stays sequential.

## Ordering

Work plan built deterministically (portraits first, then storyboards by
chapter/idx); items *started* in that order, *completion* order may vary.
- Progress `percent = completed / total` (order-independent).
- Step label: "Illustrating N images (X/total done)" rather than a strict index.
- DB rows + `params` provenance are per-item, order-independent. The *set* of
  images produced is identical to sequential.

## Invariants preserved under concurrency

- **Resume-skip:** done images filtered out before the pool runs; each item is a
  distinct subject/version → no race. (Run-stamping in Phase 0 unchanged.)
- **Transient retry:** per task — each item retries its own ComfyUI blip (3× with
  5/15/30s backoff) independently.
- **Systemic-abort (redefined):** shared `consecutiveSystemic` counter, reset to 0
  on any success, incremented when an item's retries are exhausted on a
  NETWORK/TIMEOUT-class error; at `CONSECUTIVE_SYSTEMIC_LIMIT` (4) set an `aborted`
  flag → stop launching new items, drain in-flight, then throw (BullMQ retry
  resumes via run-stamping, skipping done). Early-failure window uses shared
  attempted/failed counts similarly.
- **Failure isolation:** a non-systemic failure records a `failed` image row and
  the pool continues (settle semantics; one rejection never aborts siblings).
- Health check stays upfront; tokens/provenance unchanged.

## Build plan (worktree `feature/imagine-throughput`, TDD)

1. Extract per-item work into `processWorkItem(...)`.
2. Bounded-concurrency runner (sliding window, depth = env, default 2) with shared
   abort/counters — **TDD as a pure helper** with a fake task: depth never exceeds
   N, all items processed, systemic-abort halts new launches at the threshold,
   per-item failures isolated, ordering of starts respected.
3. Adapt systemic-abort/early-failure to the shared counters; add
   `WORKER_IMAGINE_INFLIGHT` (coerced int, default 2) to `env.ts`.
4. Wire into Phase 1.

## Testing

Unit-test the runner thoroughly (the risky part). e2e green, tsc/build clean.
**Light live check:** regenerate ~8–10 images at depth 2 — confirm correctness,
a visible wall-clock improvement, and ComfyUI queue depth >1. NOT a full
~140-image run.

## Out of scope (YAGNI)

Second ComfyUI instance / multi-stream (dropped — no benefit on one GPU);
same-prompt batching (our prompts are heterogeneous); cancelling in-flight ComfyUI
prompts on abort (we drain instead).

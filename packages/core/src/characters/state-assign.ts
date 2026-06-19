/**
 * Per-scene wardrobe-state assignment (Phase 2, chunk 3) — pure functions.
 *
 * For each illustration point, every present character that HAS appearance
 * states is placed in exactly ONE state. The spike (design doc "Extraction
 * spike findings") proved the only reliable mechanism on the small local model
 * is a HARD `z.enum` built per character from THAT character's actual
 * appearance-state ids, with a deterministic default to the character's base
 * state when the text gives no clear signal. The enum makes an out-of-list
 * pick structurally impossible; the merger below is the backstop that still
 * defaults-to-base on any miss/failure.
 *
 * Everything here is pure (no IO) so it is fully unit-testable; the LLM call
 * lives in wardrobe-assign.ts and is mocked in unit tests.
 */

import { z } from 'zod';

/** One appearance state of a character, as loaded for assignment. */
export interface CharacterStateOption {
  /** `character_appearance_states.id`. */
  id: string;
  /** 'base' | 'additional' | (Phase 4: 'underwear' | 'nude'). */
  type: string;
  /** Structured clothing descriptor (shown to the LLM to inform the pick). */
  descriptor: string;
  isBase: boolean;
}

/** A character + its appearance states, prepared for per-point assignment. */
export interface CharacterStates {
  characterId: string;
  name: string;
  states: CharacterStateOption[];
}

/**
 * The hard per-character pick contract: a Zod enum over THIS character's own
 * state ids and the resolved default-base id. `enumIds` always contains
 * `defaultBaseId`. `single` is true when the character has exactly one state
 * (the cheap shortcut: no LLM call needed — the pick is forced to base).
 */
export interface StateEnum {
  /** Zod enum constraining the pick to one of this character's state ids. */
  schema: z.ZodType<string>;
  enumIds: string[];
  /** The id to default to when unsignaled / on any failure. */
  defaultBaseId: string;
  /** True when only one state exists (forced base, skip the LLM). */
  single: boolean;
}

/**
 * Builds the hard per-character state enum + resolved default base id.
 *
 * - `defaultBaseId` is the explicit `isBase` state when present, else the first
 *   state (deterministic fallback so a malformed set without a base still has a
 *   stable default).
 * - The enum lists every state id, guaranteeing the LLM cannot pick out of set.
 * - `single` flags the one-state shortcut (assign base directly, no LLM call).
 *
 * Returns `null` when the character has NO states (nothing to assign; the
 * caller omits the character from the point's characterStates map). Pure.
 */
export function buildStateEnum(states: CharacterStateOption[]): StateEnum | null {
  if (states.length === 0) return null;

  const ids = states.map((s) => s.id);
  const base = states.find((s) => s.isBase) ?? states[0]!;
  const defaultBaseId = base.id;

  // z.enum needs a non-empty readonly string tuple; ids is guaranteed non-empty.
  const schema = z.enum(ids as [string, ...string[]]);

  return {
    schema,
    enumIds: ids,
    defaultBaseId,
    single: states.length === 1,
  };
}

/**
 * Merges the LLM's per-character picks into the point's characterStates map,
 * defaulting to each character's base on any miss. For every character with
 * states:
 *   - one state  -> base id (forced; the LLM was never asked),
 *   - many states -> the LLM's pick IF it is one of this character's ids,
 *     otherwise the default base id (the spike's failure mode — an
 *     out-of-list pick — is impossible under the hard enum, but a missing or
 *     malformed pick still falls back here).
 *
 * Characters with no states are absent from `charactersWithStates` and never
 * appear in the result. Pure; identical inputs yield an identical map.
 *
 * @param picks LLM result: characterId -> chosen state id (may be partial).
 */
export function mergeStateAssignments(
  charactersWithStates: CharacterStates[],
  picks: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const c of charactersWithStates) {
    const built = buildStateEnum(c.states);
    if (!built) continue; // no states -> omit
    if (built.single) {
      result[c.characterId] = built.defaultBaseId;
      continue;
    }
    const pick = picks[c.characterId];
    result[c.characterId] =
      pick && built.enumIds.includes(pick) ? pick : built.defaultBaseId;
  }
  return result;
}

/**
 * Partitions a point's present characters into those needing an LLM pick
 * (>=2 states) and those resolvable for free (single-state -> base). Characters
 * with no states are dropped entirely. Pure helper so the orchestrator can skip
 * the LLM call when no character needs one.
 */
export function partitionForAssignment(charactersWithStates: CharacterStates[]): {
  needLlm: CharacterStates[];
  forcedBase: Record<string, string>;
} {
  const needLlm: CharacterStates[] = [];
  const forcedBase: Record<string, string> = {};
  for (const c of charactersWithStates) {
    const built = buildStateEnum(c.states);
    if (!built) continue;
    if (built.single) {
      forcedBase[c.characterId] = built.defaultBaseId;
    } else {
      needLlm.push(c);
    }
  }
  return { needLlm, forcedBase };
}

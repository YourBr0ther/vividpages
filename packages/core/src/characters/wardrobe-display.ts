/**
 * Wardrobe display helpers (Phase 2, chunk 6) — pure functions.
 *
 * The cast page renders each character's wardrobe sheet: a body-model summary
 * line plus a row of appearance-state tiles. These helpers decide the tile
 * ORDER (base first, then additional, with the mature types slotted after so
 * Phase 4 needs no UI change) and the human LABEL per state type, and whether a
 * minor character should see the "upgrade to full wardrobe" control.
 *
 * Pure (no IO) so they are fully unit-testable; the web query/components just
 * call them with rows loaded from the DB.
 */

/** A character's appearance-state row, narrowed to what the cast UI renders. */
export interface DisplayState {
  id: string;
  /** 'base' | 'additional' now; 'underwear' | 'nude' later (Phase 4). */
  type: string;
  descriptor: string;
  isBase: boolean;
  /** Set once the reference render landed; null = not generated yet. */
  imageObjectKey: string | null;
  thumbObjectKey: string | null;
}

/**
 * Display rank per state type. Base leads; additional outfits follow; the
 * mature types (Phase 4) slot in after so the same ordering works unchanged
 * once they exist. Unknown/future types sort last.
 */
const TYPE_RANK: Record<string, number> = {
  base: 0,
  additional: 1,
  underwear: 2,
  nude: 3,
};

const UNKNOWN_RANK = 99;

/** Human labels per state type, in the same family as the rest of the cast UI. */
const TYPE_LABELS: Record<string, string> = {
  base: 'Base',
  additional: 'Additional',
  underwear: 'Underwear',
  nude: 'Nude',
};

/**
 * Orders appearance states for the wardrobe sheet: base first, then additional,
 * then any mature types, then unknown types — ties broken stably by descriptor
 * (lexicographic) so the same data always renders in the same order. Returns a
 * new array; never mutates the input. Pure.
 */
export function orderAppearanceStates<T extends DisplayState>(states: readonly T[]): T[] {
  return [...states].sort((a, b) => {
    const rankA = TYPE_RANK[a.type] ?? UNKNOWN_RANK;
    const rankB = TYPE_RANK[b.type] ?? UNKNOWN_RANK;
    if (rankA !== rankB) return rankA - rankB;
    return a.descriptor.localeCompare(b.descriptor);
  });
}

/**
 * Human label for a state type. Known types map to their fixed label; unknown
 * types fall back to a capitalized form (so a future type never renders blank).
 * Pure.
 */
export function stateTypeLabel(type: string): string {
  if (type in TYPE_LABELS) return TYPE_LABELS[type]!;
  return type ? type.charAt(0).toUpperCase() + type.slice(1) : '';
}

/**
 * Whether a character should show the minor "upgrade to full wardrobe" control.
 * Only minors (mains already get the full sheet), and only when they don't yet
 * have their own wardrobe states — either not upgraded (the upgrade button) or
 * upgraded-but-pending its next pipeline run (the "pending" status). A minor
 * that already has states is just rendered with its sheet. Pure.
 */
export function showsUpgradeControl(character: {
  role: string;
  wardrobeUpgraded: boolean;
  stateCount: number;
}): boolean {
  return character.role === 'minor' && character.stateCount === 0;
}

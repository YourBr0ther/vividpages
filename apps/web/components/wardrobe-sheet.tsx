import type { CastMember, CastWardrobeState } from '@/lib/queries';

import { WardrobeUpgradeToggle } from './wardrobe-upgrade-toggle';

/**
 * One appearance-state tile: the reference render (thumb) when it exists, a
 * graceful placeholder when it hasn't been generated yet, a type label
 * ("Base"/"Additional"/…), and the outfit descriptor. The tile list renders
 * whatever states exist, so the Phase 4 underwear/nude tiles will appear here
 * unchanged once those state types are produced. Server-renderable.
 */
function StateTile({ state }: { state: CastWardrobeState }) {
  return (
    <li className="flex w-28 shrink-0 flex-col gap-1.5">
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-md border border-stone-800/70 bg-stone-950/50">
        {state.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- streamed from MinIO via the same image route as portraits
          <img
            src={state.imageUrl}
            alt={`${state.typeLabel} outfit reference`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            aria-label="Reference not generated yet"
            className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center"
          >
            <span aria-hidden className="font-display text-2xl text-stone-700">
              ❦
            </span>
            <span className="text-[9px] leading-tight text-stone-600">
              Renders on next run
            </span>
          </div>
        )}
        <span className="absolute left-1 top-1 rounded-full border border-stone-700/70 bg-stone-950/80 px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.12em] text-stone-300">
          {state.typeLabel}
        </span>
      </div>
      <p className="text-[10px] leading-snug text-stone-500" title={state.descriptor}>
        {state.descriptor}
      </p>
    </li>
  );
}

/**
 * The wardrobe sheet shown on a character card: the body-model summary line
 * followed by a horizontal row of appearance-state tiles. Characters with NO
 * states render nothing here (the card stays exactly as before), EXCEPT minors,
 * who instead get the "upgrade to full wardrobe" control. Server-renderable
 * apart from the client upgrade toggle it embeds.
 */
export function WardrobeSheet({ member }: { member: CastMember }) {
  const hasStates = member.wardrobeStates.length > 0;
  const showUpgrade = member.role === 'minor' && !hasStates;

  // No states and not an upgradeable minor (i.e. a main mid-pipeline) → nothing
  // to add; the card renders exactly as it did before this chunk.
  if (!hasStates && !showUpgrade) return null;

  return (
    <section
      aria-label="Wardrobe"
      className="mt-1 space-y-2 border-t border-stone-800/70 pt-3"
    >
      <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
        <span aria-hidden className="text-ember-400/70">
          ✦
        </span>
        Wardrobe
      </h4>

      {member.bodyModel ? (
        <p className="text-[11px] leading-relaxed text-stone-400">
          <span className="text-[9px] uppercase tracking-[0.15em] text-stone-600">Body</span>{' '}
          {member.bodyModel}
        </p>
      ) : null}

      {hasStates ? (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {member.wardrobeStates.map((state) => (
            <StateTile key={state.id} state={state} />
          ))}
        </ul>
      ) : null}

      {showUpgrade ? (
        <WardrobeUpgradeToggle
          characterId={member.id}
          characterName={member.name}
          initialUpgraded={member.wardrobeUpgraded}
        />
      ) : null}
    </section>
  );
}

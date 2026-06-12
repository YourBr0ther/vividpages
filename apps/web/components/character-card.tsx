import type { CastMember, CastRole } from '@/lib/queries';

import { bindingFor } from './book-cover-art';

/** Role badge tints: ember for leads, deep red for villains, quiet otherwise. */
const ROLE_BADGE_CLASS: Record<CastRole, string> = {
  protagonist: 'border-ember-400/40 bg-ember-400/10 text-ember-300',
  antagonist: 'border-red-400/40 bg-red-950/50 text-red-300',
  supporting: 'border-stone-700 bg-stone-900/70 text-stone-400',
  minor: 'border-stone-800 bg-stone-900/50 text-stone-500',
};

const ROLE_LABEL: Record<CastRole, string> = {
  protagonist: 'Protagonist',
  antagonist: 'Antagonist',
  supporting: 'Supporting',
  minor: 'Minor',
};

/** The trait fields rendered as chips, in display order. */
const CHIP_TRAITS = [
  ['hair', 'hair'],
  ['eyes', 'eyes'],
  ['build', 'build'],
  ['attire', 'attire'],
] as const;

/**
 * Portrait slot: the character's image when one exists (M5), else a
 * cloth-binding monogram plate in the book-cover fallback's duotone style.
 */
function Portrait({ member }: { member: CastMember }) {
  if (member.imageUrl) {
    return (
      // Plain <img>: portraits will be private, per-user streamed objects.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={member.imageUrl}
        alt={`Portrait of ${member.name}`}
        className="h-full w-full object-cover"
      />
    );
  }
  const [from, to] = bindingFor(member.name);
  const monogram = [...member.name.trim()][0]?.toUpperCase() ?? '?';
  return (
    <div
      aria-hidden
      className="flex h-full w-full items-center justify-center"
      style={{
        background: `radial-gradient(120% 90% at 50% 20%, ${from}, ${to})`,
      }}
    >
      <span className="flex h-20 w-20 items-center justify-center rounded-full border border-parchment/25 ring-1 ring-parchment/10 ring-offset-4 ring-offset-transparent">
        <span className="font-display text-4xl text-parchment/75">{monogram}</span>
      </span>
    </div>
  );
}

/**
 * One member of the cast: portrait plate, name, role badge, aliases, the
 * one-line visual identity, quiet trait chips, and the appearance token
 * behind a disclosure for transparency. Server-renderable (no hooks).
 */
export function CharacterCard({ member }: { member: CastMember }) {
  const { profile } = member;
  const chips = profile
    ? CHIP_TRAITS.flatMap(([key, label]) => {
        const value = profile[key];
        return value ? [{ label, value }] : [];
      })
    : [];

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-stone-800/70 bg-stone-900/40 transition hover:border-stone-700">
      <div className="relative aspect-[3/4] w-full overflow-hidden border-b border-stone-800/70">
        <Portrait member={member} />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ boxShadow: 'inset 0 0 48px rgba(0,0,0,0.45)' }}
        />
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 truncate font-display text-lg leading-tight tracking-tight text-parchment">
            {member.name}
          </h3>
          <span
            className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] ${ROLE_BADGE_CLASS[member.role]}`}
          >
            {ROLE_LABEL[member.role]}
          </span>
        </div>

        {member.aliases.length > 0 ? (
          <p className="truncate text-xs text-stone-500" title={member.aliases.join(', ')}>
            also: {member.aliases.join(', ')}
          </p>
        ) : null}

        {profile?.oneLine ? (
          <p className="text-sm italic leading-relaxed text-stone-400">{profile.oneLine}</p>
        ) : null}

        {chips.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <li
                key={chip.label}
                className="inline-flex items-baseline gap-1.5 rounded-full border border-stone-800 bg-stone-950/40 px-2 py-0.5 text-[11px] text-stone-400"
              >
                <span className="text-[9px] uppercase tracking-[0.15em] text-stone-600">
                  {chip.label}
                </span>
                {chip.value}
              </li>
            ))}
          </ul>
        ) : null}

        <p className="mt-auto pt-1 text-xs text-stone-500">
          Appears in {member.sceneCount} {member.sceneCount === 1 ? 'scene' : 'scenes'}
        </p>

        {member.appearanceToken ? (
          <details className="group/token -mx-1 rounded-md px-1">
            <summary className="cursor-pointer select-none text-[11px] uppercase tracking-[0.18em] text-stone-600 transition hover:text-stone-400 focus-visible:ring-2 focus-visible:ring-ember-400/70">
              Image prompt fragment
            </summary>
            <p className="mt-1.5 rounded-md border border-stone-800/70 bg-stone-950/50 p-2 font-mono text-[11px] leading-relaxed text-stone-400">
              {member.appearanceToken}
            </p>
          </details>
        ) : null}
      </div>
    </article>
  );
}

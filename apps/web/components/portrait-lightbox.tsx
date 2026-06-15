'use client';

import { useState } from 'react';

import { Lightbox } from '@/components/lightbox';

/**
 * A character portrait that opens the shared lightbox when clicked. Renders
 * the streamed thumbnail inline (the card grid never pulls full renders);
 * the lightbox itself loads the full image plus provenance lazily.
 */
export function PortraitLightbox({
  characterId,
  imageId,
  thumbUrl,
  name,
}: {
  /** The character's id — the subject the versions/regenerate APIs key on. */
  characterId: string;
  /** Latest finished portrait image id (the lightbox opens on it). */
  imageId: string;
  thumbUrl: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`View portrait of ${name}`}
        className="block h-full w-full cursor-zoom-in focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ember-400/70"
      >
        {/* Plain <img>: portraits are private, per-user streamed objects. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumbUrl} alt={`Portrait of ${name}`} className="h-full w-full object-cover" />
      </button>
      {open ? (
        <Lightbox
          imageId={imageId}
          subject={{ kind: 'character_portrait', id: characterId }}
          title={name}
          // Portraits are taller than wide; seed the plate close to the real
          // shape until the metadata's exact dimensions arrive.
          width={3}
          height={4}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

import { z } from 'zod';

/** Character roles: `main` (followed across the book) vs `minor` (a scene or two). */
export const CHARACTER_ROLES = ['main', 'minor'] as const;
export type CharacterRole = (typeof CHARACTER_ROLES)[number];

/** Max length of the compact one-line visual identity. */
export const ONE_LINE_MAX_CHARS = 140;

/**
 * Canonical visual profile for one character, merged from every mention in
 * the book. Trait fields are null when the text never describes them — the
 * profiler must not invent appearance details.
 */
export const characterProfileSchema = z.object({
  hair: z.string().nullable().default(null),
  eyes: z.string().nullable().default(null),
  skin: z.string().nullable().default(null),
  build: z.string().nullable().default(null),
  age: z.string().nullable().default(null),
  attire: z.string().nullable().default(null),
  /** Scars, marks, props — anything visually identifying. */
  distinguishing: z.string().nullable().default(null),
  /** Short visual identity line for image prompts. */
  oneLine: z.string().min(1).max(ONE_LINE_MAX_CHARS),
  role: z.enum(CHARACTER_ROLES),
});

export type CharacterProfile = z.infer<typeof characterProfileSchema>;

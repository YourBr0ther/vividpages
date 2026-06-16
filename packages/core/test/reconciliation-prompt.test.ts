import { describe, expect, it } from 'vitest';

import {
  buildReconciliationPrompt,
  type SurvivorCharacter,
} from '../src/pipeline/profiles';

const survivor = (over: Partial<SurvivorCharacter> = {}): SurvivorCharacter => ({
  id: '00000000-0000-0000-0000-000000000000',
  name: 'Trystan',
  aliases: [],
  descriptionSample: null,
  embedding: null,
  sceneCount: 10,
  role: 'main',
  hasProfile: true,
  ...over,
});

describe('buildReconciliationPrompt', () => {
  it('lists each survivor with name, aliases, description and scene count', () => {
    const { prompt } = buildReconciliationPrompt('Test Book', [
      survivor({ name: 'Trystan', sceneCount: 63 }),
      survivor({
        name: 'The Villain',
        aliases: ['the dark one'],
        descriptionSample: 'a cruel masked figure',
        sceneCount: 35,
      }),
    ]);
    expect(prompt).toContain('Trystan');
    expect(prompt).toContain('The Villain');
    expect(prompt).toContain('the dark one');
    expect(prompt).toContain('a cruel masked figure');
    expect(prompt).toContain('63 scene');
    expect(prompt).toContain('35 scene');
  });

  it('keeps the conservative safety rules (no merging distinct people / when unsure do not merge)', () => {
    const { prompt } = buildReconciliationPrompt('Test Book', [survivor()]);
    expect(prompt).toMatch(/provably the SAME person/i);
    expect(prompt).toMatch(/never merge .*who merely interact, are related, or work together/i);
    expect(prompt).toMatch(/when unsure, do NOT merge/i);
    // Distinct numbered/generic entries stay separate.
    expect(prompt).toMatch(/DIFFERENT people/i);
  });

  it('instructs the model to identify personal-name ↔ title/epithet identity using descriptions', () => {
    const { prompt } = buildReconciliationPrompt('Test Book', [survivor()]);
    // Personal name vs. standalone title/epithet (e.g. "Trystan" / "The Villain").
    expect(prompt).toMatch(
      /personal name and a standalone title\/epithet .*same person/i,
    );
    expect(prompt).toContain('"Trystan" and "The Villain"');
    // Must lean on the descriptions to confirm one identity.
    expect(prompt).toMatch(/use the provided descriptions/i);
    // …while staying conservative: a title only absorbs into the holder.
    expect(prompt).toMatch(
      /only absorbs into the one character the book identifies as holding that role/i,
    );
  });
});

import { describe, expect, it } from 'vitest';

import {
  candidateNames,
  findRosterMatch,
  nameKey,
  normalizeCharacterName,
} from '../src/analysis/roster';

describe('normalizeCharacterName', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeCharacterName('  Evie   Sage ')).toBe('Evie Sage');
  });

  it('preserves case and diacritics for display', () => {
    expect(normalizeCharacterName('Renée')).toBe('Renée');
  });
});

describe('nameKey', () => {
  it('is case-insensitive', () => {
    expect(nameKey('EVIE')).toBe(nameKey('evie'));
  });

  it('is diacritics-insensitive', () => {
    expect(nameKey('Renée')).toBe(nameKey('renee'));
  });

  it('ignores extra whitespace', () => {
    expect(nameKey(' Evie  Sage ')).toBe(nameKey('Evie Sage'));
  });
});

describe('candidateNames', () => {
  it('returns just the normalized name when there is no parenthetical', () => {
    expect(candidateNames('  Evie  Sage ')).toEqual(['Evie Sage']);
  });

  it('splits a trailing parenthetical into full, outer and inner candidates', () => {
    expect(candidateNames('Trystan (The Villain)')).toEqual([
      'Trystan (The Villain)',
      'Trystan',
      'The Villain',
    ]);
  });

  it('handles the epithet-first form', () => {
    expect(candidateNames('The Villain (Trystan)')).toEqual([
      'The Villain (Trystan)',
      'The Villain',
      'Trystan',
    ]);
  });

  it('drops empty fragments and dedupes', () => {
    expect(candidateNames('Evie ()')).toEqual(['Evie ()', 'Evie']);
    expect(candidateNames('')).toEqual([]);
  });
});

describe('findRosterMatch', () => {
  const roster = [
    { name: 'Evie', aliases: ['Evangelina'] },
    { name: 'Trystan', aliases: ['The Villain', 'Boss'] },
    { name: 'Renée', aliases: [] },
  ];

  it('matches by name case-insensitively', () => {
    expect(findRosterMatch(roster, 'evie')).toBe(roster[0]);
  });

  it('matches by alias case-insensitively', () => {
    expect(findRosterMatch(roster, 'the villain')).toBe(roster[1]);
    expect(findRosterMatch(roster, 'Evangelina')).toBe(roster[0]);
  });

  it('matches diacritics-insensitively', () => {
    expect(findRosterMatch(roster, 'Renee')).toBe(roster[2]);
  });

  it('ignores surrounding whitespace in the query', () => {
    expect(findRosterMatch(roster, '  Boss ')).toBe(roster[1]);
  });

  it('returns undefined when nothing matches', () => {
    expect(findRosterMatch(roster, 'Kingsley')).toBeUndefined();
  });
});

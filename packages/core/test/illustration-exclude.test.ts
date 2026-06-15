import { describe, expect, it } from 'vitest';

import { isNonNarrative } from '../src/illustration/exclude';

describe('isNonNarrative', () => {
  it('treats a chapter under the word floor as non-narrative (real-book idx 0, 34w untitled)', () => {
    expect(isNonNarrative({ title: null, wordCount: 34 })).toBe(true);
  });

  it('treats a "by <Author>" promo as non-narrative (real-book idx 62)', () => {
    expect(
      isNonNarrative({
        title: 'Star Bringer, by Tracy Wolff and Nina Croft',
        wordCount: 221,
      }),
    ).toBe(true);
  });

  it('treats a long Prologue as narrative (real-book, 5796w)', () => {
    expect(isNonNarrative({ title: 'Prologue', wordCount: 5796 })).toBe(false);
  });

  it('treats a numbered chapter as narrative (real-book "Chapter 2", 1577w)', () => {
    expect(isNonNarrative({ title: 'Chapter 2', wordCount: 1577 })).toBe(false);
  });

  it('treats a long Dedication as non-narrative (title pattern overrides word count)', () => {
    expect(isNonNarrative({ title: 'Dedication', wordCount: 1000 })).toBe(true);
  });

  it('treats a long Epilogue as narrative (2000w)', () => {
    expect(isNonNarrative({ title: 'Epilogue', wordCount: 2000 })).toBe(false);
  });

  it('matches common front/back-matter titles case-insensitively', () => {
    const titles = [
      'Copyright',
      'COPYRIGHT',
      'Acknowledgements',
      'Acknowledgments',
      'Acknowledgment',
      'Contents',
      'Table of Contents',
      'About the Author',
      'Also by Tracy Wolff',
      'Title Page',
      'Foreword',
      'Epigraph',
      'Index',
      'Glossary',
      'Praise for Star Bringer',
    ];
    for (const title of titles) {
      expect(isNonNarrative({ title, wordCount: 1000 })).toBe(true);
    }
  });

  it('matches a "by <Name>" title that starts with by', () => {
    expect(isNonNarrative({ title: 'by Tracy Wolff', wordCount: 1000 })).toBe(true);
  });

  it('does not flag a normal narrative chapter title', () => {
    expect(isNonNarrative({ title: 'The Long Road Home', wordCount: 3000 })).toBe(false);
  });
});

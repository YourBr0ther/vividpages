import { describe, expect, it } from 'vitest';

import { locateQuote } from '../src/illustration/locate';

describe('locateQuote', () => {
  it('finds an exact match and snaps to the start of the containing paragraph', () => {
    const text = 'First paragraph.\n\nShe drew her sword and charged.';
    const offset = locateQuote(text, 'She drew her sword and charged.');
    // Paragraph start is right after the "\n\n".
    expect(offset).toBe(text.indexOf('She drew'));
  });

  it('returns 0 when the match is in the first paragraph (no prior boundary)', () => {
    const text = 'She drew her sword and charged.\n\nLater that night.';
    expect(locateQuote(text, 'sword and charged')).toBe(0);
  });

  it('matches a whitespace-variant quote (collapsed runs)', () => {
    const text = 'Intro.\n\nThe   castle    loomed\nover the valley.';
    const offset = locateQuote(text, 'The castle loomed over the valley.');
    expect(offset).toBe(text.indexOf('The   castle'));
  });

  it('matches a case-variant quote', () => {
    const text = 'Intro.\n\nThe Castle Loomed over the valley.';
    const offset = locateQuote(text, 'the castle loomed');
    expect(offset).toBe(text.indexOf('The Castle'));
  });

  it('returns null when the quote is not found', () => {
    const text = 'First paragraph.\n\nSecond paragraph.';
    expect(locateQuote(text, 'a quote that does not appear')).toBeNull();
  });

  it('snaps to the correct paragraph in a multi-paragraph text', () => {
    const p0 = 'Opening lines set the scene.';
    const p1 = 'The dragon descended from the clouds.';
    const p2 = 'Everyone scattered in terror.';
    const text = `${p0}\n\n${p1}\n\n${p2}`;
    const offset = locateQuote(text, 'dragon descended');
    expect(offset).toBe(text.indexOf(p1));
  });
});

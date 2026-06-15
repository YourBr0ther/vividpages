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

  // --- Typographic-normalization robustness (the live re-illustration bug) ---

  it('matches curly-quote text against a straight-quote query', () => {
    const para = '“We have minutes, not hours,” she said, drawing her ‘old’ sidearm.';
    const text = `Intro.\n\n${para}`;
    const offset = locateQuote(text, '"We have minutes, not hours," she said, drawing her \'old\' sidearm.');
    expect(offset).toBe(text.indexOf(para));
  });

  it('matches ellipsis (…) text against a "..." query', () => {
    const para = 'And then… nothing but the wind.';
    const text = `Intro.\n\n${para}`;
    const offset = locateQuote(text, 'And then... nothing but the wind.');
    expect(offset).toBe(text.indexOf(para));
  });

  it('matches "..." text against an ellipsis (…) query', () => {
    const para = 'And then... nothing but the wind.';
    const text = `Intro.\n\n${para}`;
    const offset = locateQuote(text, 'And then… nothing but the wind.');
    expect(offset).toBe(text.indexOf(para));
  });

  it('matches em-dash (—) text against a hyphen query', () => {
    const para = 'She paused — just for a heartbeat — then ran.';
    const text = `Intro.\n\n${para}`;
    const offset = locateQuote(text, 'She paused - just for a heartbeat - then ran.');
    expect(offset).toBe(text.indexOf(para));
  });

  it('matches en-dash (–) text against a hyphen query', () => {
    const para = 'The years 1914–1918 changed everything.';
    const text = `Intro.\n\n${para}`;
    const offset = locateQuote(text, 'The years 1914-1918 changed everything.');
    expect(offset).toBe(text.indexOf(para));
  });

  it('matches an LLM-truncated anchor (query is the first clause of a longer sentence)', () => {
    const para =
      'The captain drew her sidearm and scanned the smoke-filled corridor, '
      + 'her jaw set against the rising heat and the distant shriek of alarms.';
    const text = `Intro.\n\n${para}`;
    // LLM reproduced only the opening clause.
    const offset = locateQuote(text, 'The captain drew her sidearm and scanned the smoke-filled corridor.');
    expect(offset).toBe(text.indexOf(para));
  });

  it('matches an LLM-extended anchor via the trailing window (last words)', () => {
    const para = 'Jonas wrenched the panel free as sparks danced across his goggles.';
    const text = `Intro.\n\n${para}`;
    // LLM prepended a clause that is not present in the text.
    const offset = locateQuote(
      text,
      'In a shower of light, Jonas wrenched the panel free as sparks danced across his goggles.',
    );
    expect(offset).toBe(text.indexOf(para));
  });

  it('returns null for a genuinely absent quote even with the substring fallback', () => {
    const text = 'First paragraph here.\n\nSecond paragraph entirely unrelated.';
    expect(locateQuote(text, 'wholly invented dragons soared over distant mountains')).toBeNull();
  });

  it('never returns an out-of-range offset on a fallback hit', () => {
    const para = 'She drew her sword and charged into the fray without hesitation.';
    const text = `Intro.\n\n${para}`;
    const offset = locateQuote(text, 'She drew her sword and charged into the fray.');
    expect(offset).not.toBeNull();
    expect(offset!).toBeGreaterThanOrEqual(0);
    expect(offset!).toBeLessThan(text.length);
  });
});

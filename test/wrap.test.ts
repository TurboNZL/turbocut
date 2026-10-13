import { describe, expect, it } from 'vitest';
import { wrapText } from '../src/render/captions.ts';

const mono = (s: string) => s.length * 10; // every character is 10 px wide

describe('wrapText', () => {
  it('keeps a short caption on one line', () => expect(wrapText('Hell yeah.', 300, mono)).toEqual(['Hell yeah.']));
  it('wraps at word boundaries within the width', () =>
    expect(wrapText("Bro someone's hitting a jig", 150, mono)).toEqual(["Bro someone's", 'hitting a jig']));
  it('never splits a word, even one wider than the limit', () => expect(wrapText('supercalifragilistic is long', 100, mono)).toEqual(['supercalifragilistic', 'is long']));
  it('honours explicit newlines and collapses extra spaces', () => expect(wrapText('one  two\nthree', 500, mono)).toEqual(['one two', 'three']));
});

import { distanceTo } from '../src/render/outlinedText.ts';

describe('distanceTo', () => {
  it('measures straight and diagonal distances to the nearest masked pixel', () => {
    const w = 21;
    const h = 21;
    const mask = new Uint8Array(w * h);
    mask[10 * w + 10] = 1; // one pixel in the middle
    const d = distanceTo(mask, w, h);
    expect(d[10 * w + 10]).toBe(0);
    expect(d[10 * w + 15]).toBeCloseTo(5, 5); // 5 px straight
    expect(d[15 * w + 10]).toBeCloseTo(5, 5);
    expect(d[15 * w + 15]).toBeCloseTo(7.07, 0); // diagonal: chamfer 3-4 is within ~8 percent of Euclidean
    expect(Math.abs(d[15 * w + 15]! - 7.07)).toBeLessThan(0.6);
  });
});

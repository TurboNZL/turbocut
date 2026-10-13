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

import { describe, expect, it } from 'vitest';
import { cueAt, splitCue } from '../src/core/captions.ts';
import { createProject } from '../src/core/timeline.ts';
import type { CaptionCue, Project } from '../src/core/types.ts';

const withCue = (cue: CaptionCue): Project => {
  const p = createProject({ fps: 30 });
  p.captions = [cue];
  return p;
};
const words = (...w: [string, number, number][]) => w.map(([text, start, end]) => ({ text, start, end }));

describe('splitCue', () => {
  it('cuts a generated caption between its words, at the playhead', () => {
    const p = withCue({ id: 'a', start: 0, end: 60, text: 'one two three four', style: 'Default', words: words(['one', 0, 12], ['two', 15, 28], ['three', 32, 45], ['four', 48, 60]) });
    const right = splitCue(p, 'a', 30)!;
    expect(p.captions.map((c) => [c.text, c.start, c.end])).toEqual([['one two', 0, 30], ['three four', 30, 60]]);
    expect(right.words!.map((w) => w.text)).toEqual(['three', 'four']);
    expect(p.captions[0]!.words!.map((w) => w.text)).toEqual(['one', 'two']);
    expect(new Set(p.captions.map((c) => c.id)).size).toBe(2);
  });

  it('gives a word that straddles the cut to the side its middle is on', () => {
    const p = withCue({ id: 'a', start: 0, end: 40, text: 'hello world', style: 'Default', words: words(['hello', 0, 18], ['world', 18, 40]) });
    splitCue(p, 'a', 25); // inside "world" (middle 29): world stays right
    expect(p.captions.map((c) => c.text)).toEqual(['hello', 'world']);
  });

  it('never leaves a side empty, even when the cut is next to the edge', () => {
    const p = withCue({ id: 'a', start: 0, end: 40, text: 'a b c', style: 'Default', words: words(['a', 0, 10], ['b', 12, 25], ['c', 26, 40]) });
    splitCue(p, 'a', 2);
    expect(p.captions.map((c) => c.text)).toEqual(['a', 'b c']);
  });

  it('divides plain text by where the cut falls when there are no word timings', () => {
    const p = withCue({ id: 'a', start: 0, end: 100, text: 'the quick brown fox', style: 'Default' });
    splitCue(p, 'a', 50);
    expect(p.captions.map((c) => c.text)).toEqual(['the quick', 'brown fox']);
    expect(p.captions[0]!.words).toBeUndefined();
  });

  it('refuses a cut outside the caption, on its edge, or in a one-word caption', () => {
    const p = withCue({ id: 'a', start: 10, end: 40, text: 'one two', style: 'Default' });
    expect(splitCue(p, 'a', 10)).toBeUndefined();
    expect(splitCue(p, 'a', 40)).toBeUndefined();
    expect(splitCue(p, 'a', 5)).toBeUndefined();
    expect(splitCue(p, 'nope', 20)).toBeUndefined();
    const single = withCue({ id: 's', start: 0, end: 30, text: 'wow', style: 'Default' });
    expect(splitCue(single, 's', 15)).toBeUndefined();
    expect(single.captions).toHaveLength(1);
  });

  it('keeps captions in time order and finds the one under a frame', () => {
    const p = createProject({ fps: 30 });
    p.captions = [
      { id: 'a', start: 0, end: 30, text: 'x y', style: 'Default' },
      { id: 'b', start: 60, end: 90, text: 'later one', style: 'Default' },
    ];
    splitCue(p, 'a', 15);
    expect(p.captions.map((c) => c.start)).toEqual([0, 15, 60]);
    expect(cueAt(p, 20)?.text).toBe('y');
    expect(cueAt(p, 45)).toBeUndefined();
  });
});

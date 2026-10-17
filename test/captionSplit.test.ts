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

import { addClip, createClip, moveClips } from '../src/core/timeline.ts';

describe('moveClips', () => {
  const three = () => {
    const p = createProject({ fps: 30 });
    const v = p.tracks[0]!;
    const a = createClip('x', 0, 60);
    const b = createClip('x', 60, 60);
    const c = createClip('x', 200, 60);
    for (const k of [a, b, c]) addClip(p, v.id, k);
    return { p, v, a, b, c };
  };

  it('moves a group together, even into the space one of them leaves', () => {
    const { p, a, b, c } = three();
    expect(moveClips(p, [a.id, b.id], 30)).toBe(true);
    expect([a.start, b.start, c.start]).toEqual([30, 90, 200]);
  });

  it('moves nothing when one of them would hit a clip that is not moving, or start before 0', () => {
    const { p, a, b, c } = three();
    expect(moveClips(p, [a.id, b.id], 100)).toBe(false); // b would end at 220, over c
    expect(moveClips(p, [b.id, c.id], -70)).toBe(false); // b would start at -10
    expect([a.start, b.start, c.start]).toEqual([0, 60, 200]);
  });

  it('takes linked partners along and keeps tracks sorted', () => {
    const p = createProject({ fps: 30 });
    const [v, au] = p.tracks as [typeof p.tracks[0], typeof p.tracks[0]];
    const vc = { ...createClip('x', 0, 60), link: 'l1' };
    const ac = { ...createClip('x', 0, 60), link: 'l1' };
    addClip(p, v!.id, vc);
    addClip(p, au!.id, ac);
    expect(moveClips(p, [vc.id], 45)).toBe(true);
    expect([vc.start, ac.start]).toEqual([45, 45]);
    expect(moveClips(p, ['nope'], 5)).toBe(false);
  });
});

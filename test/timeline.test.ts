import { describe, expect, it } from 'vitest';
import { audioGain, evalProp, gainAtRel, setKeyframe } from '../src/core/keyframes.ts';
import { addClip, createClip, createProject, moveClip, moveLinked, projectDuration, removeLinked, rippleDelete, splitAt, splitLinked, trimEnd, trimStart } from '../src/core/timeline.ts';
import { groupWords, SHORTS_GROUPING } from '../src/transcribe/provider.ts';
import { parseClipSlug } from '../src/twitch/clip.ts';

const setup = () => {
  const p = createProject({ fps: 30 });
  const v = p.tracks[0]!;
  const c = createClip('a1', 0, 300, 100);
  addClip(p, v.id, c);
  return { p, v, c };
};

describe('timeline', () => {
  it('splits and keeps source continuity', () => {
    const { p, v, c } = setup();
    const r = splitAt(p, c.id, 120)!;
    expect(c.duration).toBe(120);
    expect(r.start).toBe(120);
    expect(r.duration).toBe(180);
    expect(r.sourceIn).toBe(220);
    expect(v.clips.map((x) => x.id)).toEqual([c.id, r.id]);
    expect(splitAt(p, c.id, 0)).toBeUndefined();
  });

  it('re-bases keyframes when splitting', () => {
    const { p, c } = setup();
    c.keys.scale = setKeyframe(setKeyframe(undefined, { t: 0, v: 1, ease: 'linear' }), { t: 200, v: 2, ease: 'linear' });
    const r = splitAt(p, c.id, 100)!;
    expect(r.keys.scale!.map((k) => k.t)).toEqual([-100, 100]);
    expect(evalProp(r, 'scale', 100)).toBeCloseTo(1.5, 5); // continuous across the cut
    expect(evalProp(c, 'scale', 99)).toBeCloseTo(1.495, 5);
  });

  it('trims head and tail without overlapping neighbours', () => {
    const { p, c } = setup();
    trimStart(p, c.id, 30);
    expect(c).toMatchObject({ start: 30, duration: 270, sourceIn: 130 });
    trimEnd(p, c.id, 200);
    expect(c.duration).toBe(170);
  });

  it('refuses to move onto another clip, allows free space', () => {
    const { p, v, c } = setup();
    const d = createClip('a2', 400, 100);
    addClip(p, v.id, d);
    expect(moveClip(p, d.id, 250)).toBe(false);
    expect(moveClip(p, d.id, 300)).toBe(true);
    expect(() => addClip(p, v.id, createClip('a3', 10, 10))).toThrow();
    expect(projectDuration(p)).toBe(400);
    p.captions.push({ id: 'x', start: 390, end: 900, text: 'late', style: 'Default' });
    expect(projectDuration(p)).toBe(400); // captions do not extend the project
    expect(moveClip(p, c.id, 0, p.tracks[1]!.id)).toBe(false); // video clip onto audio track
  });

  it('ripple delete closes the gap', () => {
    const { p, v, c } = setup();
    const d = createClip('a2', 300, 100);
    addClip(p, v.id, d);
    rippleDelete(p, c.id);
    expect(d.start).toBe(0);
  });
});

describe('keyframes and audio', () => {
  it('interpolates, holds and eases', () => {
    const { c } = setup();
    c.keys.x = [{ t: 0, v: 0, ease: 'linear' }, { t: 100, v: 100, ease: 'hold' }, { t: 200, v: 0, ease: 'linear' }];
    expect(evalProp(c, 'x', 50)).toBeCloseTo(50);
    expect(evalProp(c, 'x', 150)).toBe(100);
    expect(evalProp(c, 'x', 999)).toBe(0);
    expect(evalProp(c, 'opacity', 10)).toBe(1);
  });

  it('applies linear audio fades', () => {
    const { c } = setup();
    c.audioFadeIn = 30;
    c.audioFadeOut = 30;
    expect(audioGain(c, 0)).toBe(0);
    expect(audioGain(c, 15)).toBeCloseTo(0.5);
    expect(audioGain(c, 150)).toBe(1);
    expect(audioGain(c, 285)).toBeCloseTo(0.5);
    expect(audioGain(c, 300)).toBe(0);
    expect(gainAtRel(c, 300)).toBe(0); // fade-out ends silent, inclusive end
    c.audioFadeOut = 0;
    expect(gainAtRel(c, 300)).toBe(1);
  });
});

describe('captions from words', () => {
  it('groups by pause, words and chars', () => {
    const words = [
      { text: 'Bro', start: 0, end: 0.2 }, { text: "someone's", start: 0.2, end: 0.6 },
      { text: 'hitting', start: 0.6, end: 0.9 }, { text: 'a', start: 0.9, end: 1.0 },
      { text: 'jig', start: 2.0, end: 2.4 },
    ];
    const cues = groupWords(words, { fps: 30, ...SHORTS_GROUPING });
    expect(cues.map((c) => c.text)).toEqual(["Bro someone's", 'hitting a', 'jig']);
    expect(cues[0]!.words).toHaveLength(2);
  });
});

describe('twitch slugs', () => {
  it.each([
    ['https://clips.twitch.tv/AwkwardHelplessSalamanderSwiftRage-abc123', 'AwkwardHelplessSalamanderSwiftRage-abc123'],
    ['https://www.twitch.tv/somechannel/clip/FunnySlug_x9?filter=clips', 'FunnySlug_x9'],
    ['m.twitch.tv/somechannel/clip/FunnySlug_x9', 'FunnySlug_x9'],
    ['https://clips.twitch.tv/embed?clip=EmbedSlug-1&parent=x', 'EmbedSlug-1'],
    ['BareSlug-123', 'BareSlug-123'],
  ])('parses %s', (input, slug) => expect(parseClipSlug(input)).toBe(slug));

  it('rejects other sites', () => {
    expect(parseClipSlug('https://youtube.com/watch?v=abc123')).toBeNull();
    expect(parseClipSlug('')).toBeNull();
  });
});

describe('linked clips', () => {
  const linkedSetup = () => {
    const p = createProject({ fps: 30 });
    const v = createClip('a', 0, 300);
    const a = createClip('a', 0, 300);
    v.link = a.link = 'L1';
    addClip(p, p.tracks[0]!.id, v);
    addClip(p, p.tracks[1]!.id, a);
    return { p, v, a };
  };

  it('splits both halves and gives the right halves a shared new link', () => {
    const { p, v, a } = linkedSetup();
    const rights = splitLinked(p, v.id, 100);
    expect(rights).toHaveLength(2);
    expect(a.duration).toBe(100);
    expect(rights[0]!.link).toBe(rights[1]!.link);
    expect(rights[0]!.link).not.toBe('L1');
  });

  it('removes both, and ripples both', () => {
    const { p, v } = linkedSetup();
    const next = createClip('b', 300, 50);
    addClip(p, p.tracks[0]!.id, next);
    removeLinked(p, v.id, true);
    expect(p.tracks[1]!.clips).toHaveLength(0);
    expect(next.start).toBe(0);
  });

  it('moves the pair together or not at all', () => {
    const { p, v, a } = linkedSetup();
    expect(moveLinked(p, v.id, 50)).toBe(true);
    expect([v.start, a.start]).toEqual([50, 50]);
    addClip(p, p.tracks[1]!.id, createClip('c', 400, 50)); // blocks the audio side only
    expect(moveLinked(p, v.id, 200)).toBe(false);
    expect([v.start, a.start]).toEqual([50, 50]);
  });
});

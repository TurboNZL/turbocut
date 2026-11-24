import { describe, expect, it } from 'vitest';
import { changeFps } from '../src/core/fps.ts';
import { addClip, clipEnd, createClip, createProject } from '../src/core/timeline.ts';

describe('changeFps', () => {
  it('keeps the length in seconds and keeps neighbours touching', () => {
    const p = createProject({ fps: 30 });
    const v = p.tracks[0]!;
    p.assets.a = { id: 'a', name: 'a.mp4', ref: 'a', hasVideo: true, hasAudio: false, duration: 90, width: 1, height: 1 };
    const one = createClip('a', 0, 45);
    one.keys.x = [{ t: 0, v: 0, ease: 'linear' }, { t: 30, v: 10, ease: 'linear' }];
    addClip(p, v.id, one);
    addClip(p, v.id, createClip('a', 45, 45, 15));
    p.captions.push({ id: 'c', start: 30, end: 60, text: 'hi', style: 'Default', words: [{ text: 'hi', start: 30, end: 60 }] });
    changeFps(p, 60);
    expect(p.fps).toBe(60);
    expect(p.assets.a!.duration).toBe(180);
    const [a, b] = v.clips;
    expect(a!.start).toBe(0);
    expect(clipEnd(a!)).toBe(90);
    expect(b!.start).toBe(90);
    expect(b!.sourceIn).toBe(30);
    expect(a!.keys.x![1]!.t).toBe(60);
    expect(p.captions[0]).toMatchObject({ start: 60, end: 120 });
    changeFps(p, 30);
    expect(clipEnd(v.clips[1]!)).toBe(90);
  });
  it('refuses nonsense', () => {
    expect(() => changeFps(createProject(), 0)).toThrow();
    expect(() => changeFps(createProject(), 500)).toThrow();
  });
});

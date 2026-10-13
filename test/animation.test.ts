import { describe, expect, it } from 'vitest';
import { keyTimes, neighbourKey, paramsFor, valueAt } from '../src/core/animation.ts';
import { setKeyframe } from '../src/core/keyframes.ts';
import { addClip, createClip, createProject, splitAt } from '../src/core/timeline.ts';

const byId = (kind: 'video' | 'audio', id: string) => paramsFor(kind).find((p) => p.id === id)!;

describe('params', () => {
  it('reads and writes plain properties, with keys', () => {
    const c = createClip('a', 0, 100);
    const zoom = byId('video', 'scale');
    expect(valueAt(zoom, c, 10)).toBe(1);
    zoom.setBase(c, 2);
    expect(valueAt(zoom, c, 10)).toBe(2);
    zoom.setKeys(c, setKeyframe(setKeyframe(undefined, { t: 0, v: 1, ease: 'linear' }), { t: 100, v: 3, ease: 'linear' }));
    expect(valueAt(zoom, c, 50)).toBeCloseTo(2);
    zoom.setKeys(c, undefined);
    expect(zoom.keys(c)).toBeUndefined();
    expect(valueAt(zoom, c, 50)).toBe(2); // back to the static value
  });

  it('creates an effect when it is first used and removes it when it is zero and unkeyed', () => {
    const c = createClip('a', 0, 100);
    const blur = byId('video', 'blur');
    expect(c.effects).toHaveLength(0);
    blur.setBase(c, 12);
    expect(c.effects).toEqual([{ type: 'blur', kind: 'gaussian', radius: 12 }]);
    blur.setBase(c, 0);
    expect(c.effects).toHaveLength(0);
    blur.setKeys(c, [{ t: 0, v: 0, ease: 'linear' }, { t: 30, v: 40, ease: 'linear' }]);
    expect(c.effects[0]!.radiusKeys).toHaveLength(2);
    expect(valueAt(blur, c, 15)).toBeCloseTo(20);
    blur.setBase(c, 0);
    expect(c.effects).toHaveLength(1); // still keyed, so it stays
    blur.setKeys(c, undefined);
    expect(c.effects).toHaveLength(0); // unkeyed and zero: gone
  });

  it('audio volume is a parameter shown as percent', () => {
    const vol = byId('audio', 'volume');
    expect([vol.scale, vol.max]).toEqual([100, 2]);
    const c = createClip('a', 0, 60);
    vol.setKeys(c, [{ t: 0, v: 1, ease: 'linear' }, { t: 60, v: 0, ease: 'linear' }]);
    expect(valueAt(vol, c, 30)).toBeCloseTo(0.5);
  });
});

describe('key navigation', () => {
  it('lists key times across parameters and finds neighbours', () => {
    const c = createClip('a', 0, 100);
    byId('video', 'scale').setKeys(c, [{ t: 10, v: 1, ease: 'linear' }, { t: 40, v: 2, ease: 'linear' }]);
    byId('video', 'x').setKeys(c, [{ t: 40, v: 0, ease: 'linear' }, { t: 90, v: 5, ease: 'linear' }]);
    const times = keyTimes(c, paramsFor('video'));
    expect(times).toEqual([10, 40, 90]);
    expect(neighbourKey(times, 10, 1)).toBe(40);
    expect(neighbourKey(times, 40, -1)).toBe(10);
    expect(neighbourKey(times, 95, 1)).toBeUndefined();
    expect(neighbourKey(times, 5, -1)).toBeUndefined();
  });
});

describe('text clips', () => {
  it('survive a split with their text and keys', () => {
    const p = createProject();
    const c = createClip('', 0, 100);
    c.text = { content: 'Hello', style: { name: 'T', fontname: 'Arial', fontsize: 100 } as any, animation: { type: 'none' } };
    byId('video', 'x').setKeys(c, [{ t: 0, v: 0, ease: 'linear' }, { t: 80, v: 80, ease: 'linear' }]);
    addClip(p, p.tracks[0]!.id, c);
    const right = splitAt(p, c.id, 40)!;
    expect(right.text?.content).toBe('Hello');
    expect(right.text).not.toBe(c.text); // a copy, not shared
    expect(byId('video', 'x').keys(right)!.map((k) => k.t)).toEqual([-40, 40]);
  });
});

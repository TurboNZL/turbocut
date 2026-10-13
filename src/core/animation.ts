import { sample } from './keyframes.ts';
import { ANIM_DEFAULTS, type AnimProp, type BlurKind, type Clip, type Frame, type Keyframe } from './types.ts';

/**
 * One animatable setting of a clip: zoom, position, opacity, an effect's strength, audio volume. The inspector, the
 * keyframe editor and the next/previous keyframe jump all work through this one shape, so a new parameter is added
 * in one place. Keyframe times are frames from the start of the clip.
 */
export interface Param {
  id: string;
  label: string;
  /** Range in stored units multiplied by `scale` (opacity is stored 0..1 and shown as percent). */
  min: number;
  max: number;
  step: number;
  scale: number;
  keys(c: Clip): Keyframe[] | undefined;
  setKeys(c: Clip, keys: Keyframe[] | undefined): void;
  base(c: Clip): number;
  setBase(c: Clip, v: number): void;
}

const prop = (id: AnimProp, label: string, min: number, max: number, step: number, scale = 1): Param => ({
  id,
  label,
  min,
  max,
  step,
  scale,
  keys: (c) => c.keys[id],
  setKeys: (c, k) => {
    if (k && k.length) c.keys[id] = k;
    else delete c.keys[id];
  },
  base: (c) => c.base[id] ?? ANIM_DEFAULTS[id],
  setBase: (c, v) => {
    c.base[id] = v;
  },
});

/** Blur and pixelate live in the clip's effect list; the effect appears when it is first used and goes when it is zero and unkeyed. */
const effect = (kind: BlurKind, id: string, label: string, max: number): Param => {
  const find = (c: Clip) => c.effects.find((e) => e.kind === kind);
  const tidy = (c: Clip) => {
    const e = find(c);
    if (e && e.radius <= 0 && !(e.radiusKeys && e.radiusKeys.length)) c.effects = c.effects.filter((x) => x !== e);
  };
  const ensure = (c: Clip) => {
    let e = find(c);
    if (!e) c.effects.push((e = { type: 'blur', kind, radius: 0 }));
    return e;
  };
  return {
    id,
    label,
    min: 0,
    max,
    step: 1,
    scale: 1,
    keys: (c) => find(c)?.radiusKeys,
    setKeys: (c, k) => {
      if (k && k.length) ensure(c).radiusKeys = k;
      else {
        const e = find(c);
        if (e) delete e.radiusKeys;
        tidy(c);
      }
    },
    base: (c) => find(c)?.radius ?? 0,
    setBase: (c, v) => {
      ensure(c).radius = v;
      tidy(c);
    },
  };
};

const VIDEO: Param[] = [
  prop('scale', 'Zoom', 0.2, 4, 0.01),
  prop('x', 'X', -1500, 1500, 1),
  prop('y', 'Y', -1500, 1500, 1),
  prop('rotation', 'Rotate', -180, 180, 0.5),
  prop('opacity', 'Opacity %', 0, 1, 0.01, 100),
  effect('gaussian', 'blur', 'Blur', 80),
  effect('pixelate', 'pixelate', 'Pixelate', 120),
];
const AUDIO: Param[] = [prop('volume', 'Volume %', 0, 2, 0.01, 100)];

export const paramsFor = (kind: 'video' | 'audio'): Param[] => (kind === 'audio' ? AUDIO : VIDEO);

/** Value of a parameter at a frame relative to the start of the clip. */
export function valueAt(p: Param, c: Clip, rel: Frame): number {
  const keys = p.keys(c);
  const base = p.base(c);
  return keys && keys.length ? sample(keys, rel, base) : base;
}

/** Every frame (relative to the clip) that has a keyframe on any parameter, sorted and without repeats. */
export function keyTimes(c: Clip, params: Param[]): Frame[] {
  const set = new Set<Frame>();
  for (const p of params) for (const k of p.keys(c) ?? []) set.add(k.t);
  return [...set].sort((a, b) => a - b);
}

/** The next (dir 1) or previous (dir -1) keyframe strictly after or before `rel`, if there is one. */
export function neighbourKey(times: Frame[], rel: Frame, dir: 1 | -1): Frame | undefined {
  return dir > 0 ? times.find((t) => t > rel) : [...times].reverse().find((t) => t < rel);
}

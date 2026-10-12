import { ease } from './easing.ts';
import { ANIM_DEFAULTS, type AnimProp, type Clip, type Frame, type Keyframe } from './types.ts';

/** Keep keyframes sorted and unique by time. Returns a new array. */
export function setKeyframe(keys: Keyframe[] | undefined, kf: Keyframe): Keyframe[] {
  const out = (keys ?? []).filter((k) => k.t !== kf.t);
  out.push(kf);
  out.sort((a, b) => a.t - b.t);
  return out;
}

export function removeKeyframe(keys: Keyframe[] | undefined, t: Frame): Keyframe[] {
  return (keys ?? []).filter((k) => k.t !== t);
}

/** Value of a keyframe track at clip-relative frame `t`. */
export function sample(keys: Keyframe[], t: Frame, fallback: number): number {
  if (keys.length === 0) return fallback;
  const first = keys[0]!;
  if (t <= first.t) return first.v;
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return last.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (t >= a.t && t < b.t) {
      if (a.ease === 'hold') return a.v;
      const k = ease(a.ease, (t - a.t) / (b.t - a.t));
      return a.v + (b.v - a.v) * k;
    }
  }
  return last.v;
}

/** Evaluate one animated property of a clip at a timeline frame. */
export function evalProp(clip: Clip, prop: AnimProp, timelineFrame: Frame): number {
  const fallback = clip.base[prop] ?? ANIM_DEFAULTS[prop];
  const keys = clip.keys[prop];
  if (!keys || keys.length === 0) return fallback;
  return sample(keys, timelineFrame - clip.start, fallback);
}

/** Audio gain at a timeline frame: volume property times linear fade in/out. */
export function audioGain(clip: Clip, timelineFrame: Frame): number {
  if (clip.muted) return 0;
  const rel = timelineFrame - clip.start;
  if (rel < 0 || rel >= clip.duration) return 0;
  let g = evalProp(clip, 'volume', timelineFrame);
  if (clip.audioFadeIn > 0 && rel < clip.audioFadeIn) g *= rel / clip.audioFadeIn;
  const fromEnd = clip.duration - rel;
  if (clip.audioFadeOut > 0 && fromEnd < clip.audioFadeOut) g *= fromEnd / clip.audioFadeOut;
  return g;
}

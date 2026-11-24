import type { Keyframe, Project } from './types.ts';

/** The frame rates the project settings offer. Anything from 1 to 240 is accepted when typed. */
export const FRAME_RATES = [24, 25, 30, 50, 60] as const;

/**
 * Change the project's frame rate. Time is stored as integer frames of the project rate, so every frame number is rescaled and the
 * edit keeps its length in seconds: a cut at 2 s stays at 2 s. Boundaries are rounded once, so two clips that touched still touch.
 */
export function changeFps(p: Project, fps: number): void {
  if (!Number.isFinite(fps) || fps < 1 || fps > 240) throw new Error('The frame rate must be between 1 and 240.');
  const to = Math.round(fps);
  const from = p.fps;
  if (to === from) return;
  const k = to / from;
  const at = (f: number) => Math.round(f * k);
  const keys = (list?: Keyframe[]) => list?.map((x) => ({ ...x, t: at(x.t) }));
  for (const a of Object.values(p.assets)) a.duration = Math.max(1, at(a.duration));
  for (const t of p.tracks) {
    for (const c of t.clips) {
      const start = at(c.start);
      const end = Math.max(start + 1, at(c.start + c.duration));
      c.start = start;
      c.duration = end - start;
      c.sourceIn = at(c.sourceIn);
      c.audioFadeIn = at(c.audioFadeIn);
      c.audioFadeOut = at(c.audioFadeOut);
      for (const prop of Object.keys(c.keys) as (keyof typeof c.keys)[]) c.keys[prop] = keys(c.keys[prop]);
      for (const e of c.effects) if (e.radiusKeys) e.radiusKeys = keys(e.radiusKeys);
      if (c.text?.animation.type === 'bounce') c.text.animation = { ...c.text.animation, frames: Math.min(60, Math.max(1, at(c.text.animation.frames))) };
    }
    t.clips.sort((x, y) => x.start - y.start);
  }
  for (const cue of p.captions) {
    cue.start = at(cue.start);
    cue.end = Math.max(cue.start + 1, at(cue.end));
    if (cue.words) cue.words = cue.words.map((w) => ({ ...w, start: at(w.start), end: Math.max(at(w.start) + 1, at(w.end)) }));
  }
  p.fps = to;
}

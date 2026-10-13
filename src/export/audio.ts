import { gainAtRel } from '../core/keyframes.ts';
import { clipEnd } from '../core/timeline.ts';
import type { Clip, Project } from '../core/types.ts';
import type { MediaLibrary } from '../media/library.ts';

export const MIX_RATE = 48000;
export const MIX_WINDOW_SECONDS = 30;

/** Gain automation points for a clip, in timeline frames: the edges, keyframes, fades, and a coarse sampling between. */
function gainPoints(clip: Clip): number[] {
  const pts = new Set<number>([0, clip.duration]);
  if (clip.audioFadeIn > 0) pts.add(Math.min(clip.audioFadeIn, clip.duration));
  if (clip.audioFadeOut > 0) pts.add(Math.max(0, clip.duration - clip.audioFadeOut));
  for (const k of clip.keys.volume ?? []) if (k.t >= 0 && k.t <= clip.duration) pts.add(k.t);
  if (clip.keys.volume?.length || clip.audioFadeIn || clip.audioFadeOut) for (let t = 0; t < clip.duration; t += 4) pts.add(t);
  return [...pts].sort((a, b) => a - b);
}

/**
 * Mix every audio clip overlapping [t0, t1) seconds into one stereo buffer. Windowed so a 20 minute
 * edit never needs a 20 minute buffer in memory.
 */
export async function mixWindow(
  p: Project,
  lib: MediaLibrary,
  t0: number,
  t1: number,
  fmt: { rate: number; channels: number } = { rate: MIX_RATE, channels: 2 },
): Promise<AudioBuffer> {
  const length = Math.max(1, Math.round((t1 - t0) * fmt.rate));
  const ctx = new OfflineAudioContext(fmt.channels, length, fmt.rate);

  for (const track of p.tracks) {
    if (track.kind !== 'audio') continue;
    for (const clip of track.clips) {
      const cs = clip.start / p.fps;
      const ce = clipEnd(clip) / p.fps;
      if (clip.muted || ce <= t0 || cs >= t1) continue;

      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      // Automate gain only inside this window, with a synthetic point at each window edge so
      // clips that began earlier (or end later) keep the right level.
      const winLen = t1 - t0;
      const relStart = Math.max(0, Math.round((t0 - cs) * p.fps));
      const relEnd = Math.min(clip.duration, Math.round((t1 - cs) * p.fps));
      const rels = new Set<number>([relStart, relEnd]);
      for (const r of gainPoints(clip)) if (r > relStart && r < relEnd) rels.add(r);
      [...rels].sort((a, b) => a - b).forEach((rel, i) => {
        const when = Math.min(winLen, Math.max(0, (clip.start + rel) / p.fps - t0));
        const v = Math.max(0, gainAtRel(clip, rel));
        if (i === 0) gain.gain.setValueAtTime(v, when);
        else gain.gain.linearRampToValueAtTime(v, when);
      });

      // Source seconds covered by this window.
      const winStart = Math.max(t0, cs);
      const winEnd = Math.min(t1, ce);
      const srcFrom = clip.sourceIn / p.fps + (winStart - cs) * clip.speed;
      const srcTo = clip.sourceIn / p.fps + (winEnd - cs) * clip.speed;
      for await (const chunk of lib.audioChunks(clip.assetId, srcFrom, srcTo)) {
        const node = ctx.createBufferSource();
        node.buffer = chunk.buffer;
        node.playbackRate.value = clip.speed;
        node.connect(gain);
        // Where this decoded chunk starts on the timeline, and how much of it to skip or drop.
        const chunkTimeline = cs + (chunk.timestamp - clip.sourceIn / p.fps) / clip.speed;
        const startAt = chunkTimeline - t0;
        const stopAt = ce - t0;
        if (startAt >= 0) node.start(startAt);
        else node.start(0, -startAt * clip.speed);
        node.stop(Math.max(0, stopAt));
      }
    }
  }
  return ctx.startRendering();
}

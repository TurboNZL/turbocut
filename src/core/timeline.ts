import type { Clip, Frame, Project, Track } from './types.ts';

let counter = 0;
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`;

export function createProject(opts: Partial<Pick<Project, 'name' | 'fps' | 'width' | 'height'>> = {}): Project {
  return {
    version: 1,
    name: opts.name ?? 'Untitled',
    fps: opts.fps ?? 30,
    width: opts.width ?? 1080,
    height: opts.height ?? 1920,
    assets: {},
    tracks: [
      { id: newId('t'), kind: 'video', name: 'V1', clips: [], locked: false, hidden: false },
      { id: newId('t'), kind: 'audio', name: 'A1', clips: [], locked: false, hidden: false },
    ],
    captions: [],
    captionPreset: null,
  };
}

export function createClip(assetId: string, start: Frame, duration: Frame, sourceIn: Frame = 0): Clip {
  return {
    id: newId('c'),
    assetId,
    start,
    duration,
    sourceIn,
    speed: 1,
    keys: {},
    base: {},
    effects: [],
    audioFadeIn: 0,
    audioFadeOut: 0,
    muted: false,
  };
}

export const clipEnd = (c: Clip): Frame => c.start + c.duration;

export function projectDuration(p: Project): Frame {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
  for (const cue of p.captions) end = Math.max(end, cue.end);
  return end;
}

export function findClip(p: Project, clipId: string): { track: Track; clip: Clip } | undefined {
  for (const track of p.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
}

function sortTrack(track: Track) {
  track.clips.sort((a, b) => a.start - b.start);
}

/** Does [start, start+duration) collide with any clip on the track other than `ignore`? */
export function overlaps(track: Track, start: Frame, duration: Frame, ignore?: string): boolean {
  const end = start + duration;
  return track.clips.some((c) => c.id !== ignore && start < clipEnd(c) && end > c.start);
}

/** Add a clip. Throws if it collides, so callers choose where to put it. */
export function addClip(p: Project, trackId: string, clip: Clip): void {
  const track = p.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`No track ${trackId}`);
  if (overlaps(track, clip.start, clip.duration)) throw new Error('Clip overlaps another clip on this track');
  track.clips.push(clip);
  sortTrack(track);
}

/** Split the clip under `frame` into two. Keyframes are re-based onto each half. Returns the new right clip. */
export function splitAt(p: Project, clipId: string, frame: Frame): Clip | undefined {
  const hit = findClip(p, clipId);
  if (!hit) return;
  const { track, clip } = hit;
  if (frame <= clip.start || frame >= clipEnd(clip)) return;
  const cut = frame - clip.start;
  const right: Clip = structuredClone(clip);
  right.id = newId('c');
  right.start = frame;
  right.duration = clip.duration - cut;
  right.sourceIn = clip.sourceIn + Math.round(cut * clip.speed);
  right.audioFadeIn = 0;
  clip.audioFadeOut = 0;
  clip.duration = cut;
  // keyframe times are relative to the clip start
  for (const prop of Object.keys(right.keys) as (keyof Clip['keys'])[]) {
    const ks = right.keys[prop];
    if (ks) right.keys[prop] = ks.map((k) => ({ ...k, t: k.t - cut }));
  }
  track.clips.push(right);
  sortTrack(track);
  return right;
}

/** Trim the head of a clip to `frame` (timeline coordinates). */
export function trimStart(p: Project, clipId: string, frame: Frame): void {
  const hit = findClip(p, clipId);
  if (!hit) return;
  const { track, clip } = hit;
  const delta = frame - clip.start;
  if (delta >= clip.duration) return;
  const prevEnd = Math.max(0, ...track.clips.filter((c) => c !== clip && clipEnd(c) <= clip.start).map(clipEnd));
  const newStart = Math.max(frame, prevEnd, clip.start - Math.floor(clip.sourceIn / clip.speed));
  const d = newStart - clip.start;
  clip.start = newStart;
  clip.duration -= d;
  clip.sourceIn += Math.round(d * clip.speed);
  for (const prop of Object.keys(clip.keys) as (keyof Clip['keys'])[]) {
    const ks = clip.keys[prop];
    if (ks) clip.keys[prop] = ks.map((k) => ({ ...k, t: k.t - d }));
  }
}

/** Trim the tail of a clip to `frame` (timeline coordinates). */
export function trimEnd(p: Project, clipId: string, frame: Frame): void {
  const hit = findClip(p, clipId);
  if (!hit) return;
  const { track, clip } = hit;
  if (frame <= clip.start) return;
  const next = Math.min(Infinity, ...track.clips.filter((c) => c !== clip && c.start >= clipEnd(clip)).map((c) => c.start));
  clip.duration = Math.min(frame, next) - clip.start;
}

/** Move a clip to a new start (and optionally another track). Refuses overlaps. Returns whether it moved. */
export function moveClip(p: Project, clipId: string, start: Frame, toTrackId?: string): boolean {
  const hit = findClip(p, clipId);
  if (!hit) return false;
  const dest = toTrackId ? p.tracks.find((t) => t.id === toTrackId) : hit.track;
  if (!dest || dest.locked || start < 0) return false;
  if (dest.kind !== hit.track.kind) return false;
  if (overlaps(dest, start, hit.clip.duration, clipId)) return false;
  hit.track.clips = hit.track.clips.filter((c) => c !== hit.clip);
  hit.clip.start = start;
  dest.clips.push(hit.clip);
  sortTrack(dest);
  return true;
}

/** Delete a clip and close the gap it leaves on its own track. */
export function rippleDelete(p: Project, clipId: string): void {
  const hit = findClip(p, clipId);
  if (!hit) return;
  const { track, clip } = hit;
  const gap = clip.duration;
  const at = clip.start;
  track.clips = track.clips.filter((c) => c !== clip);
  for (const c of track.clips) if (c.start >= at) c.start -= gap;
}

export function deleteClip(p: Project, clipId: string): void {
  const hit = findClip(p, clipId);
  if (hit) hit.track.clips = hit.track.clips.filter((c) => c !== hit.clip);
}

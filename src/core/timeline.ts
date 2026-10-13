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

/** End of the last media clip. Captions never extend a project: one that runs past the media would export as black video. */
export function projectDuration(p: Project): Frame {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
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

/** Every clip that shares a link id with `clip` (including itself). */
export function linkedClips(p: Project, clip: Clip): { track: Track; clip: Clip }[] {
  const out: { track: Track; clip: Clip }[] = [];
  for (const track of p.tracks)
    for (const c of track.clips) if (c === clip || (clip.link && c.link === clip.link)) out.push({ track, clip: c });
  return out;
}

/** Split a clip and its linked partners at `frame`. The new right halves share a fresh link id. */
export function splitLinked(p: Project, clipId: string, frame: Frame): Clip[] {
  const hit = findClip(p, clipId);
  if (!hit) return [];
  const rights: Clip[] = [];
  for (const { clip } of linkedClips(p, hit.clip)) {
    const r = splitAt(p, clip.id, frame);
    if (r) rights.push(r);
  }
  if (hit.clip.link && rights.length > 1) {
    const link = newId('l');
    for (const r of rights) r.link = link;
  }
  return rights;
}

/** Remove a clip and its linked partners, optionally closing the gaps. */
export function removeLinked(p: Project, clipId: string, ripple: boolean): void {
  const hit = findClip(p, clipId);
  if (!hit) return;
  for (const { clip } of linkedClips(p, hit.clip)) (ripple ? rippleDelete : deleteClip)(p, clip.id);
}

/** Move a clip and its linked partners by the same offset. Refuses (changes nothing) if any would collide. */
export function moveLinked(p: Project, clipId: string, start: Frame, toTrackId?: string): boolean {
  const hit = findClip(p, clipId);
  if (!hit) return false;
  const delta = start - hit.clip.start;
  const group = linkedClips(p, hit.clip);
  const before = group.map(({ clip }) => clip.start);
  const trackBefore = group.map(({ track }) => track.id);
  const ok = group.every(({ clip }, i) => moveClip(p, clip.id, before[i]! + delta, clip === hit.clip ? toTrackId : undefined));
  if (!ok) {
    // roll back what moved
    group.forEach(({ clip }, i) => moveClip(p, clip.id, before[i]!, trackBefore[i]));
  }
  return ok;
}

const PREFIX = { video: 'V', audio: 'A' } as const;

/** Add a track of `kind` above the existing ones of that kind and return it. Named V1, V2... or A1, A2... */
export function addTrack(p: Project, kind: Track['kind']): Track {
  const n = p.tracks.filter((t) => t.kind === kind).length + 1;
  const track: Track = { id: newId('t'), kind, name: `${PREFIX[kind]}${n}`, clips: [], locked: false, hidden: false };
  p.tracks.push(track);
  return track;
}

/** Remove an empty track. Refuses (returns false) when it holds clips or it is the last track of its kind. */
export function removeTrack(p: Project, trackId: string): boolean {
  const t = p.tracks.find((x) => x.id === trackId);
  if (!t || t.clips.length > 0 || p.tracks.filter((x) => x.kind === t.kind).length <= 1) return false;
  p.tracks = p.tracks.filter((x) => x !== t);
  // keep the names tidy: V1, V2... in order
  for (const kind of ['video', 'audio'] as const) p.tracks.filter((x) => x.kind === kind).forEach((x, i) => (x.name = `${PREFIX[kind]}${i + 1}`));
  return true;
}

/** The earliest start at or after `from` where a clip of `duration` frames fits on every one of `tracks`. */
export function findFreeStart(tracks: Track[], from: Frame, duration: number): Frame {
  let s = Math.max(0, from);
  for (let guard = 0; guard < 10000; guard++) {
    const blocker = tracks.flatMap((t) => t.clips).find((c) => s < clipEnd(c) && s + duration > c.start);
    if (!blocker) return s;
    s = clipEnd(blocker);
  }
  return s;
}

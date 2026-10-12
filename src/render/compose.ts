import { evalProp, sample } from '../core/keyframes.ts';
import { clipEnd } from '../core/timeline.ts';
import type { BlurEffect, Clip, Frame, Project } from '../core/types.ts';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Gives the compositor the decoded picture for a clip at a timeline frame. Two implementations:
 * random access for scrubbing (`MediaLibrary`) and a pipelined sequential one for export.
 */
export interface FrameSource {
  getFrame(clip: Clip, frame: Frame, sourceSeconds: number): Promise<CanvasImageSource | null>;
}

export function sourceSeconds(p: Project, clip: Clip, frame: Frame): number {
  return (clip.sourceIn + (frame - clip.start) * clip.speed) / p.fps;
}

export function clipAt(track: { clips: Clip[] }, frame: Frame): Clip | undefined {
  // Clips are sorted and never overlap on a track, so a linear scan from the front is fine for editor-sized tracks.
  for (const c of track.clips) {
    if (frame < c.start) return;
    if (frame < clipEnd(c)) return c;
  }
}

const dims = (img: CanvasImageSource): [number, number] => {
  const a = img as { displayWidth?: number; displayHeight?: number; videoWidth?: number; videoHeight?: number; width?: number; height?: number };
  return [a.displayWidth ?? a.videoWidth ?? (a.width as number), a.displayHeight ?? a.videoHeight ?? (a.height as number)];
};

function blurRadius(e: BlurEffect, clip: Clip, frame: Frame): number {
  return Math.max(0, e.radiusKeys?.length ? sample(e.radiusKeys, frame - clip.start, e.radius) : e.radius);
}

/**
 * Draw one video clip: "cover" fit into the project frame, then the clip's own transform
 * (x, y in pixels from centre, scale, rotation in degrees, opacity) and its effects.
 */
export function drawClip(ctx: Ctx2D, p: Project, clip: Clip, frame: Frame, img: CanvasImageSource): void {
  const [sw, sh] = dims(img);
  if (!sw || !sh) return;
  const fit = Math.max(p.width / sw, p.height / sh);
  const scale = fit * evalProp(clip, 'scale', frame);
  const opacity = evalProp(clip, 'opacity', frame);
  if (opacity <= 0) return;

  let blur = 0;
  let pixelate = 0;
  for (const e of clip.effects) {
    const r = blurRadius(e, clip, frame);
    if (e.kind === 'gaussian') blur += r;
    else if (e.kind === 'pixelate') pixelate = Math.max(pixelate, r);
  }

  ctx.save();
  ctx.globalAlpha = Math.min(1, opacity);
  ctx.translate(p.width / 2 + evalProp(clip, 'x', frame), p.height / 2 + evalProp(clip, 'y', frame));
  ctx.rotate((evalProp(clip, 'rotation', frame) * Math.PI) / 180);
  ctx.scale(scale, scale);
  if (blur > 0) ctx.filter = `blur(${blur / scale}px)`; // radius is in project pixels, the filter runs in the scaled space
  if (pixelate >= 1) {
    // Draw small, then blow up without smoothing. `pixelate` is the block size in project pixels.
    const bw = Math.max(1, Math.round((sw * scale) / pixelate));
    const bh = Math.max(1, Math.round((sh * scale) / pixelate));
    const tmp = new OffscreenCanvas(bw, bh);
    tmp.getContext('2d')!.drawImage(img, 0, 0, bw, bh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, -sw / 2, -sh / 2, sw, sh);
  } else {
    ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
  }
  ctx.restore();
}

/** Paint every visible video track, bottom to top, for one timeline frame. */
export async function drawVideo(ctx: Ctx2D, p: Project, frame: Frame, src: FrameSource): Promise<void> {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, p.width, p.height);
  for (const track of p.tracks) {
    if (track.kind !== 'video' || track.hidden) continue;
    const clip = clipAt(track, frame);
    if (!clip) continue;
    const img = await src.getFrame(clip, frame, sourceSeconds(p, clip, frame));
    if (img) drawClip(ctx, p, clip, frame, img);
  }
}

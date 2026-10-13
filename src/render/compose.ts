import { evalProp, sample } from '../core/keyframes.ts';
import { clipEnd } from '../core/timeline.ts';
import type { BlurEffect, Clip, Frame, Project } from '../core/types.ts';
import { textPicture } from './textLayer.ts';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * One picture to composite: a decoded video frame (drawn with its rotation and flip metadata applied) or a bitmap.
 * Holding a decoded frame costs real memory, so whoever gets a picture with `close` must call it right after drawing.
 */
export interface Picture {
  /** Size after rotation, in pixels. */
  width: number;
  height: number;
  draw(ctx: Ctx2D, dx: number, dy: number, dw: number, dh: number): void;
  close?(): void;
}

export const bitmapPicture = (c: OffscreenCanvas | HTMLCanvasElement): Picture => ({
  width: c.width,
  height: c.height,
  draw: (ctx, dx, dy, dw, dh) => ctx.drawImage(c, dx, dy, dw, dh),
});

/**
 * Gives the compositor the decoded picture for a clip at a timeline frame. Two implementations:
 * random access for scrubbing (`MediaLibrary`) and a pipelined sequential one for playback and export.
 */
export interface FrameSource {
  getFrame(clip: Clip, frame: Frame, sourceSeconds: number): Promise<Picture | null>;
  /** Release decoders. Must be called when a sequential source is abandoned before every clip was read to its end. */
  dispose?(): void;
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

function blurRadius(e: BlurEffect, clip: Clip, frame: Frame): number {
  return Math.max(0, e.radiusKeys?.length ? sample(e.radiusKeys, frame - clip.start, e.radius) : e.radius);
}

/**
 * Draw one video clip: "cover" fit into the project frame, then the clip's own transform
 * (x, y in pixels from centre, scale, rotation in degrees, opacity) and its effects.
 */
export function drawClip(ctx: Ctx2D, p: Project, clip: Clip, frame: Frame, pic: Picture): void {
  const sw = pic.width;
  const sh = pic.height;
  if (!sw || !sh) return;
  // Pictures and video cover the frame; a text layer keeps its natural size (the layer's Zoom scales it from there).
  const fit = clip.text ? 1 : Math.max(p.width / sw, p.height / sh);
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

  // Canvas filters work in device pixels and ignore the transform (measured: blur(10px) reaches the same
  // distance at scale 0.5, 1 and 2). So convert project pixels to device pixels with the caller's base
  // scale, which is 1 for export and below 1 for a reduced-size preview.
  const base = Math.hypot(ctx.getTransform().a, ctx.getTransform().b);

  ctx.save();
  ctx.globalAlpha = Math.min(1, opacity);
  ctx.translate(p.width / 2 + evalProp(clip, 'x', frame), p.height / 2 + evalProp(clip, 'y', frame));
  ctx.rotate((evalProp(clip, 'rotation', frame) * Math.PI) / 180);
  ctx.scale(scale, scale);
  if (blur > 0) ctx.filter = `blur(${blur * base}px)`; // blur is the radius in project pixels
  if (pixelate >= 1) {
    // Draw small, then blow up without smoothing. `pixelate` is the block size in project pixels.
    const bw = Math.max(1, Math.round((sw * scale) / pixelate));
    const bh = Math.max(1, Math.round((sh * scale) / pixelate));
    const tmp = new OffscreenCanvas(bw, bh);
    pic.draw(tmp.getContext('2d')!, 0, 0, bw, bh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, -sw / 2, -sh / 2, sw, sh);
  } else {
    pic.draw(ctx, -sw / 2, -sh / 2, sw, sh);
  }
  ctx.restore();
}

/**
 * Paint every visible video track, bottom to top, for one timeline frame.
 *
 * All frames are fetched first and the canvas is only touched afterwards, in one synchronous run.
 * Clearing before the awaits would let the browser present a black canvas between frames (flicker).
 * `overlay` runs in that same synchronous run, for captions.
 */
export async function drawVideo(ctx: Ctx2D, p: Project, frame: Frame, src: FrameSource, overlay?: () => void): Promise<void> {
  const layers: { clip: Clip; pic: Picture }[] = [];
  for (const track of p.tracks) {
    if (track.kind !== 'video' || track.hidden) continue;
    const clip = clipAt(track, frame);
    if (!clip) continue;
    const pic = clip.text ? textPicture(p, clip, frame) : await src.getFrame(clip, frame, sourceSeconds(p, clip, frame));
    if (pic) layers.push({ clip, pic });
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, p.width, p.height);
  for (const { clip, pic } of layers) drawClip(ctx, p, clip, frame, pic);
  overlay?.();
  for (const { pic } of layers) pic.close?.(); // a decoded frame is released the moment it has been drawn
}

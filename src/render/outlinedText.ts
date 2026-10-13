import type { Rgba } from '../captions/ass.ts';

export interface TextRaster {
  canvas: OffscreenCanvas;
  /** Where the anchor point sits inside the bitmap, in pixels. */
  ox: number;
  oy: number;
}

export interface RasterSpec {
  lines: string[];
  font: string;
  fontSize: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  baseline: 'alphabetic' | 'top' | 'middle';
  fill: Rgba;
  outline: Rgba;
  outlineWidth: number;
  /** What happens inside the holes of letters (e, a, g, o). Default 'filled'. */
  counters?: CounterStyle;
}

/**
 * filled: every hole fills solid with the outline colour, whatever its size (the classic stroke only managed the small ones).
 * rim:    holes keep a thinner rim of outline colour and stay open in the middle.
 * clear:  no outline inside holes at all, the picture shows straight through.
 */
export type CounterStyle = 'filled' | 'rim' | 'clear';

const rgba = (c: Rgba, k = 1) => `rgba(${c.r},${c.g},${c.b},${((c.a / 255) * k).toFixed(3)})`;

/**
 * Mark every pixel connected to the bitmap border through (nearly) empty pixels: the outside of the text.
 * Returns 1 for outside, 0 for ink or enclosed counters.
 */
export function outsideMask(alpha: Uint8ClampedArray, w: number, h: number, threshold = 8): Uint8Array {
  const out = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (i: number) => {
    if (!out[i] && alpha[i * 4 + 3]! < threshold) ((out[i] = 1), (stack[sp++] = i));
  };
  for (let x = 0; x < w; x++) (push(x), push((h - 1) * w + x));
  for (let y = 0; y < h; y++) (push(y * w), push(y * w + w - 1));
  while (sp > 0) {
    const i = stack[--sp]!;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  return out;
}

/** Label 4-connected regions of `mask` pixels. Returns the label per pixel (0 = not in the mask) and the count. */
export function labelRegions(mask: Uint8Array, w: number, h: number): { labels: Int32Array; count: number } {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let count = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    count++;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = count;
    while (sp > 0) {
      const i = stack[--sp]!;
      const x = i % w;
      const tryPush = (j: number) => {
        if (mask[j] && !labels[j]) ((labels[j] = count), (stack[sp++] = j));
      };
      if (x > 0) tryPush(i - 1);
      if (x < w - 1) tryPush(i + 1);
      if (i >= w) tryPush(i - w);
      if (i < w * (h - 1)) tryPush(i + w);
    }
  }
  return { labels, count };
}

/** Distance in pixels from each pixel to the nearest `mask` pixel (3-4 chamfer, within about 8 percent of Euclidean). */
export function distanceTo(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i]!;
      if (x > 0) v = Math.min(v, d[i - 1]! + 3);
      if (y > 0) {
        v = Math.min(v, d[i - w]! + 3);
        if (x > 0) v = Math.min(v, d[i - w - 1]! + 4);
        if (x < w - 1) v = Math.min(v, d[i - w + 1]! + 4);
      }
      d[i] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i]!;
      if (x < w - 1) v = Math.min(v, d[i + 1]! + 3);
      if (y < h - 1) {
        v = Math.min(v, d[i + w]! + 3);
        if (x < w - 1) v = Math.min(v, d[i + w + 1]! + 4);
        if (x > 0) v = Math.min(v, d[i + w - 1]! + 4);
      }
      d[i] = v;
    }
  for (let i = 0; i < d.length; i++) d[i] = d[i]! / 3; // chamfer units to pixels, only once propagation is finished
  return d;
}

/**
 * Text with an outline that only grows outward from the outside of the letters. A plain centred stroke fills
 * every counter (the holes in e, a, g, o) that is narrower than the stroke with outline colour; here the
 * outline stays within `outlineWidth` of the outside, so counters remain clear and show what is behind.
 */
export function rasterizeText(s: RasterSpec): TextRaster {
  const probe = new OffscreenCanvas(1, 1).getContext('2d')!;
  probe.font = s.font;
  const widest = Math.max(1, ...s.lines.map((l) => probe.measureText(l).width));
  const pad = Math.ceil(s.outlineWidth) + Math.ceil(s.fontSize * 0.35) + 4;
  const blockH = (s.lines.length - 1) * s.lineHeight;
  const w = Math.ceil(widest) + pad * 2;
  const h = Math.ceil(blockH + s.fontSize * 1.5) + pad * 2;
  // anchor inside the bitmap
  const ox = s.align === 'left' ? pad : s.align === 'right' ? w - pad : w / 2;
  const oy = s.baseline === 'top' ? pad : s.baseline === 'middle' ? pad + s.fontSize * 0.75 : pad + s.fontSize * 1.1;

  const draw = (ctx: OffscreenCanvasRenderingContext2D, fillStyle: string, strokeStyle?: string) => {
    ctx.font = s.font;
    ctx.textAlign = s.align;
    ctx.textBaseline = s.baseline;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    s.lines.forEach((line, i) => {
      const y = oy + i * s.lineHeight;
      if (strokeStyle) {
        ctx.lineWidth = s.outlineWidth * 2;
        ctx.strokeStyle = strokeStyle;
        ctx.strokeText(line, ox, y);
      }
      ctx.fillStyle = fillStyle;
      ctx.fillText(line, ox, y);
    });
  };

  const out = new OffscreenCanvas(w, h);
  const octx = out.getContext('2d')!;
  if (s.outlineWidth > 0) {
    // 1. the glyphs alone (ink) and the classic centred stroke plus ink (its anti-aliased shape is the outline's shape)
    const inkCanvas = new OffscreenCanvas(w, h);
    const ictx = inkCanvas.getContext('2d', { willReadFrequently: true })!;
    draw(ictx, '#000');
    const ink = ictx.getImageData(0, 0, w, h).data;
    const union = new OffscreenCanvas(w, h);
    const uctx = union.getContext('2d', { willReadFrequently: true })!;
    draw(uctx, '#000', '#000');
    const uni = uctx.getImageData(0, 0, w, h).data;

    // 2. ink mask; the outside of the ink (reachable from the border) versus holes enclosed by ink
    const isInk = new Uint8Array(w * h);
    for (let i = 0; i < isInk.length; i++) isInk[i] = ink[i * 4 + 3]! >= 128 ? 1 : 0;
    const outside = new Uint8Array(w * h);
    {
      const stack = new Int32Array(w * h);
      let sp = 0;
      const push = (i: number) => {
        if (!outside[i] && !isInk[i]) ((outside[i] = 1), (stack[sp++] = i));
      };
      for (let x = 0; x < w; x++) (push(x), push((h - 1) * w + x));
      for (let y = 0; y < h; y++) (push(y * w), push(y * w + w - 1));
      while (sp > 0) {
        const i = stack[--sp]!;
        const x = i % w;
        if (x > 0) push(i - 1);
        if (x < w - 1) push(i + 1);
        if (i >= w) push(i - w);
        if (i < w * (h - 1)) push(i + w);
      }
    }
    const dist = distanceTo(isInk, w, h); // pixels to the nearest ink

    // 3. each hole: how wide an outline rim it gets
    const holes = new Uint8Array(w * h);
    for (let i = 0; i < holes.length; i++) holes[i] = !isInk[i] && !outside[i] ? 1 : 0;
    const { labels, count } = labelRegions(holes, w, h);
    const radius = new Float32Array(count + 1); // largest distance to ink inside each hole = how open it is
    for (let i = 0; i < labels.length; i++) if (labels[i]) radius[labels[i]!] = Math.max(radius[labels[i]!]!, dist[i]!);
    const mode = s.counters ?? 'filled';
    const holeWidth = (label: number) => (mode === 'filled' ? s.outlineWidth : mode === 'clear' ? 0 : Math.min(s.outlineWidth, radius[label]! * 0.5));

    // 4. outline colour where it belongs, feathered by one pixel
    const o = octx.createImageData(w, h);
    const alphaK = s.outline.a / 255;
    for (let i = 0; i < dist.length; i++) {
      if (isInk[i]) continue;
      const inHole = !outside[i];
      // "filled" paints the whole hole, even the middle that the stroke never reaches.
      const a = inHole && mode === 'filled' ? 255 : uni[i * 4 + 3]!;
      if (!a) continue;
      const width = inHole ? holeWidth(labels[i]!) : s.outlineWidth;
      const k = inHole && mode === 'filled' ? 1 : Math.min(1, Math.max(0, width - dist[i]! + 0.5));
      if (k <= 0) continue;
      o.data[i * 4] = s.outline.r;
      o.data[i * 4 + 1] = s.outline.g;
      o.data[i * 4 + 2] = s.outline.b;
      o.data[i * 4 + 3] = Math.round(a * k * alphaK);
    }
    octx.putImageData(o, 0, 0);
  }
  draw(octx, rgba(s.fill));
  return { canvas: out, ox, oy };
}

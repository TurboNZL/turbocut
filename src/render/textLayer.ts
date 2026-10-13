import { entranceScale } from '../captions/presets.ts';
import type { Clip, Frame, Project } from '../core/types.ts';
import { wrapText } from './captions.ts';
import type { Picture } from './compose.ts';
import { rasterizeText, type TextRaster } from './outlinedText.ts';

const cache = new Map<string, TextRaster & { block: number }>();
let probe: OffscreenCanvasRenderingContext2D | null = null;

/**
 * The picture of a text layer at a frame: wrapped to the safe width, drawn with the layer's style (outline, counters,
 * colours) at the size its entrance animation has reached, and anchored on the middle of the text block so the layer's
 * position and zoom work around its centre. Returns null while the entrance animation has not started showing it.
 */
export function textPicture(p: Project, clip: Clip, frame: Frame): Picture | null {
  const t = clip.text!;
  const st = t.style;
  const s = entranceScale(t.animation, frame - clip.start);
  if (s <= 0) return null;
  const q = Math.round(s * 100) / 100;
  const font = (px: number) => `${st.italic ? 'italic ' : ''}${st.bold ? '700 ' : ''}${px}px "${st.fontname}", sans-serif`;

  probe ??= new OffscreenCanvas(1, 1).getContext('2d')!;
  probe.font = font(st.fontsize);
  const lines = wrapText(t.content, Math.max(40, p.width - st.marginL - st.marginR), (x) => probe!.measureText(x).width);

  const key = JSON.stringify([lines, st.fontname, st.fontsize, st.bold, st.italic, st.primary, st.outlineColour, st.outline, st.counters, q, document.fonts?.size ?? 0]);
  let r = cache.get(key);
  if (!r) {
    const lh = st.fontsize * 1.2;
    const raster = rasterizeText({
      lines,
      font: font(st.fontsize * q),
      fontSize: st.fontsize * q,
      lineHeight: lh * q,
      align: 'center',
      baseline: 'middle',
      fill: st.primary,
      outline: st.outlineColour,
      outlineWidth: st.outline * q,
      counters: st.counters,
    });
    r = { ...raster, block: (lines.length - 1) * lh * q };
    if (cache.size > 60) cache.delete(cache.keys().next().value!);
    cache.set(key, r);
  }
  const { canvas, ox, oy, block } = r;
  const w = canvas.width;
  const h = canvas.height;
  return {
    width: w,
    height: h,
    draw: (ctx, dx, dy, dw, dh) => ctx.drawImage(canvas, dx + ((w / 2 - ox) * dw) / w, dy + ((h / 2 - (oy + block / 2)) * dh) / h, dw, dh),
  };
}

import { entranceScale, styleByName, type CaptionPreset } from '../captions/presets.ts';
import type { AssStyle } from '../captions/ass.ts';
import type { Frame, Project } from '../core/types.ts';
import type { Ctx2D } from './compose.ts';

const css = (c: { r: number; g: number; b: number; a: number }) => `rgba(${c.r},${c.g},${c.b},${(c.a / 255).toFixed(3)})`;

/** Greedy word wrap. `width` measures a string; a single word longer than `max` stays on its own line. */
export function wrapText(text: string, max: number, width: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && width(next) > max) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** The caption cue showing at `frame`, plus how many frames it has been on screen. */
export function activeCue(p: Project, frame: Frame) {
  for (const cue of p.captions) if (frame >= cue.start && frame < cue.end) return { cue, age: frame - cue.start };
}

function anchor(style: AssStyle, w: number, h: number) {
  const col = (style.alignment - 1) % 3; // 0 left, 1 centre, 2 right
  const row = Math.floor((style.alignment - 1) / 3); // 0 bottom, 1 middle, 2 top
  const x = col === 0 ? style.marginL : col === 1 ? w / 2 : w - style.marginR;
  const y = row === 0 ? h - style.marginV : row === 1 ? h / 2 : style.marginV;
  return { x, y, align: (['left', 'center', 'right'] as const)[col]!, base: (['bottom', 'middle', 'top'] as const)[row]! };
}

/** Draw the caption for `frame` with the preset's style and entrance animation. */
export function drawCaption(ctx: Ctx2D, p: Project, preset: CaptionPreset, frame: Frame): void {
  const hit = activeCue(p, frame);
  if (!hit) return;
  const style = styleByName(preset, hit.cue.style);
  const s = entranceScale(preset.animation, hit.age);
  if (s <= 0) return;
  const a = anchor(style, p.width, p.height);
  const lh = style.fontsize * 1.2;

  ctx.save();
  ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : ''}${style.fontsize}px "${style.fontname}", sans-serif`;
  // Wrap to the safe width, like ASS does (WrapStyle 0), so a long caption never runs off the frame.
  const maxWidth = Math.max(40, p.width - style.marginL - style.marginR);
  const lines = wrapText(hit.cue.text, maxWidth, (t) => ctx.measureText(t).width);
  const block = (lines.length - 1) * lh;
  ctx.translate(a.x, a.y - (a.base === 'bottom' ? block : a.base === 'middle' ? block / 2 : 0));
  ctx.scale(s, s);
  ctx.textAlign = a.align;
  ctx.textBaseline = a.base === 'bottom' ? 'alphabetic' : a.base === 'top' ? 'top' : 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  lines.forEach((line, i) => {
    const y = i * lh;
    if (style.outline > 0) {
      ctx.lineWidth = style.outline * 2; // ASS outline is the visible width outside the glyph; the stroke is centred
      ctx.strokeStyle = css(style.outlineColour);
      ctx.strokeText(line, 0, y);
    }
    ctx.fillStyle = css(style.primary);
    ctx.fillText(line, 0, y);
  });
  ctx.restore();
}

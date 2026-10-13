import type { CaptionCue } from '../core/types.ts';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0 = transparent, 255 = opaque (CSS convention, the inverse of ASS). */
  a: number;
}

export interface AssStyle {
  name: string;
  fontname: string;
  fontsize: number;
  primary: Rgba;
  outlineColour: Rgba;
  backColour: Rgba;
  bold: boolean;
  italic: boolean;
  outline: number;
  shadow: number;
  /** Numpad alignment, 2 = bottom centre. */
  alignment: number;
  marginL: number;
  marginR: number;
  marginV: number;
  /** TurboCut extension (not part of ASS): what the holes of letters look like. Default 'filled'. */
  counters?: 'filled' | 'rim' | 'clear';
}

export interface AssDialogue {
  start: number; // seconds
  end: number;
  style: string;
  text: string; // override tags stripped
}

export interface AssFile {
  playResX: number;
  playResY: number;
  styles: AssStyle[];
  dialogue: AssDialogue[];
}

/** &HAABBGGRR -> Rgba. */
export function parseColour(s: string): Rgba {
  let h = s.trim();
  if (/^&h/i.test(h) || /^0x/i.test(h)) h = h.slice(2);
  h = h.replace(/&$/, '');
  const v = h ? parseInt(h, 16) >>> 0 : 0;
  return { a: 255 - ((v >>> 24) & 0xff), b: (v >>> 16) & 0xff, g: (v >>> 8) & 0xff, r: v & 0xff };
}

export function formatColour(c: Rgba): string {
  const v = (((255 - c.a) & 0xff) << 24) | ((c.b & 0xff) << 16) | ((c.g & 0xff) << 8) | (c.r & 0xff);
  return '&H' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

export function parseTime(t: string): number {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})[.](\d{1,3})$/.exec(t.trim());
  if (!m) throw new Error(`Bad ASS time: ${t}`);
  const frac = Number('0.' + m[4]);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frac;
}

export function formatTime(sec: number): string {
  const cs = Math.round(Math.max(0, sec) * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

const flag = (v: string | undefined) => v === '-1' || v === '1';

export function parseAss(src: string): AssFile {
  const out: AssFile = { playResX: 1080, playResY: 1920, styles: [], dialogue: [] };
  let section = '';
  let styleFmt: string[] = [];
  let eventFmt: string[] = [];

  for (const raw of src.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    if (line.startsWith('[')) {
      section = line.replace(/[[\]]/g, '').toLowerCase();
      continue;
    }
    if (section === 'script info') {
      const m = /^(PlayRes[XY]):\s*(\d+)/i.exec(line);
      if (m) (m[1]!.toLowerCase() === 'playresx' ? (out.playResX = +m[2]!) : (out.playResY = +m[2]!));
    } else if (section === 'v4+ styles') {
      if (line.startsWith('Format:')) styleFmt = line.slice(7).split(',').map((x) => x.trim());
      else if (line.startsWith('Style:')) {
        const vals = line.slice(6).split(',', styleFmt.length).map((x) => x.trim());
        const d: Record<string, string> = {};
        styleFmt.forEach((k, i) => (d[k] = vals[i] ?? ''));
        out.styles.push({
          name: d.Name ?? 'Default',
          fontname: d.Fontname ?? 'Arial',
          fontsize: parseFloat(d.Fontsize ?? '48'),
          primary: parseColour(d.PrimaryColour ?? '&H00FFFFFF'),
          outlineColour: parseColour(d.OutlineColour ?? '&H00000000'),
          backColour: parseColour(d.BackColour ?? '&H00000000'),
          bold: flag(d.Bold),
          italic: flag(d.Italic),
          outline: parseFloat(d.Outline ?? '0'),
          shadow: parseFloat(d.Shadow ?? '0'),
          alignment: parseInt(d.Alignment ?? '2', 10),
          marginL: parseInt(d.MarginL ?? '0', 10),
          marginR: parseInt(d.MarginR ?? '0', 10),
          marginV: parseInt(d.MarginV ?? '0', 10),
        });
      }
    } else if (section === 'events') {
      if (line.startsWith('Format:')) eventFmt = line.slice(7).split(',').map((x) => x.trim());
      else if (line.startsWith('Dialogue:')) {
        const parts = line.slice(9).split(',');
        const head = parts.slice(0, eventFmt.length - 1).map((x) => x.trim());
        const text = parts.slice(eventFmt.length - 1).join(',');
        const d: Record<string, string> = {};
        eventFmt.forEach((k, i) => (d[k] = i < head.length ? head[i]! : text));
        out.dialogue.push({
          start: parseTime(d.Start!),
          end: parseTime(d.End!),
          style: d.Style ?? 'Default',
          text: (d.Text ?? '').replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').trim(),
        });
      }
    }
  }
  return out;
}

export function styleToLine(s: AssStyle): string {
  const b = (v: boolean) => (v ? -1 : 0);
  return [
    s.name, s.fontname, s.fontsize.toFixed(2),
    formatColour(s.primary), '&H00FFFFFF', formatColour(s.outlineColour), formatColour(s.backColour),
    b(s.bold), b(s.italic), 0, 0, '100.00', '100.00', '0.00', '0.00', 1,
    s.outline.toFixed(2), s.shadow.toFixed(2), s.alignment, s.marginL, s.marginR, s.marginV, 1,
  ].join(',');
}

export const STYLE_FORMAT =
  'Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding';

export interface WriteAssOptions {
  styles: AssStyle[];
  cues: { start: number; end: number; style: string; text: string; tags?: string }[];
  playResX: number;
  playResY: number;
}

export function writeAss(o: WriteAssOptions): string {
  const lines = [
    '[Script Info]',
    '; Written by TurboCut',
    `PlayResX: ${o.playResX}`,
    `PlayResY: ${o.playResY}`,
    'ScaledBorderAndShadow: yes',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    `Format: ${STYLE_FORMAT}`,
    ...o.styles.map((s) => `Style: ${styleToLine(s)}`),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...o.cues.map(
      (c) =>
        `Dialogue: 0,${formatTime(c.start)},${formatTime(c.end)},${c.style},,0,0,0,,${c.tags ? `{${c.tags}}` : ''}${c.text.replace(/\n/g, '\\N')}`,
    ),
    '',
  ];
  return lines.join('\n');
}

export function dialogueToCues(d: AssDialogue[], fps: number): CaptionCue[] {
  return d.map((x, i) => ({
    id: `cue_${i}`,
    start: Math.round(x.start * fps),
    end: Math.round(x.end * fps),
    text: x.text,
    style: x.style,
  }));
}

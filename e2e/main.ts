import { presetFromAss } from '../src/captions/presets.ts';
import { dialogueToCues, parseAss } from '../src/captions/ass.ts';
import { addClip, createClip, createProject } from '../src/core/timeline.ts';
import { exportProject } from '../src/export/exporter.ts';
import { MediaLibrary } from '../src/media/library.ts';
import { drawVideo } from '../src/render/compose.ts';
import { outsideMask, rasterizeText } from '../src/render/outlinedText.ts';
import { renderPcm16k } from '../src/transcribe/pcm.ts';

declare global { interface Window { run: (opts: { captions: boolean }) => Promise<any>; previewMatchesExport: () => Promise<number>; captionHoles: () => Promise<any>; speechAudio: () => Promise<{ b64: string; samples: number }> } }

window.run = async ({ captions }) => {
  const lib = new MediaLibrary();
  const blob = await (await fetch('/e2e/.media/src.webm')).blob();
  const p = createProject({ fps: 30, width: 1080, height: 1920 });
  const asset = await lib.importFile(blob, 'src.webm', p.fps);
  p.assets[asset.id] = asset;
  const [v, a] = p.tracks;

  // Clip 1: frames 0-89 from source 0 s, slow zoom 1 -> 1.5.
  const c1 = createClip(asset.id, 0, 90, 0);
  c1.keys.scale = [{ t: 0, v: 1, ease: 'linear' }, { t: 89, v: 1.5, ease: 'linear' }];
  // Clip 2: frames 90-149 from source 3 s (a cut), gaussian blur 24 px.
  const c2 = createClip(asset.id, 90, 60, 90);
  c2.effects.push({ type: 'blur', kind: 'gaussian', radius: 24 });
  addClip(p, v!.id, c1);
  addClip(p, v!.id, c2);

  // Audio: 5 s of the source with a 1 s fade in and 1 s fade out.
  const ac = createClip(asset.id, 0, 150, 0);
  ac.audioFadeIn = 30;
  ac.audioFadeOut = 30;
  addClip(p, a!.id, ac);

  let preset = null;
  if (captions) {
    const ass = await (await fetch('/test/fixtures/sample.ass')).text();
    preset = presetFromAss('Prisma', ass);
    p.captions = dialogueToCues(parseAss(ass).dialogue, p.fps).filter((c) => c.start < 150);
  }

  const res = await exportProject(p, lib, { preset });
  const bytes = new Uint8Array(res.data);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { ...res, data: undefined, b64: btoa(bin) };
};

/**
 * A reduced-size preview must look like the full-size export. Renders one blurred, zoomed, rotated frame at
 * full size and at half size, shrinks the first to half, and returns the mean absolute difference (0..255).
 */
window.previewMatchesExport = async () => {
  const lib = new MediaLibrary();
  const blob = await (await fetch('/e2e/.media/src.webm')).blob();
  const p = createProject({ fps: 30, width: 1080, height: 1920 });
  const asset = await lib.importFile(blob, 'src.webm', p.fps);
  const c = createClip(asset.id, 0, 30, 60);
  c.base = { scale: 1.3, rotation: 7, x: 40, y: -30 };
  c.effects.push({ type: 'blur', kind: 'gaussian', radius: 20 });
  addClip(p, p.tracks[0]!.id, c);
  const render = async (s: number) => {
    const cv = new OffscreenCanvas(Math.round(p.width * s), Math.round(p.height * s));
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    await drawVideo(ctx, p, 0, lib);
    return cv;
  };
  const full = await render(1);
  const half = await render(0.5);
  const shrunk = new OffscreenCanvas(half.width, half.height);
  const sctx = shrunk.getContext('2d')!;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(full, 0, 0, half.width, half.height);
  const a = sctx.getImageData(0, 0, half.width, half.height).data;
  const b = half.getContext('2d')!.getImageData(0, 0, half.width, half.height).data;
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
  return sum / (a.length / 4) / 3;
};

/**
 * Counters (the holes in e, a, g) must stay clear. Measures enclosed transparent area for plain text (the
 * true counters), for the old centred-stroke method, and for the new outline.
 */
window.captionHoles = async () => {
  const font = '700 96px sans-serif';
  const text = 'ge a8';
  const spec = { lines: [text], font, fontSize: 96, lineHeight: 115, align: 'center' as const, baseline: 'alphabetic' as const, fill: { r: 255, g: 200, b: 0, a: 255 }, outline: { r: 0, g: 0, b: 0, a: 255 }, outlineWidth: 9 };
  const enclosed = (cv: OffscreenCanvas) => {
    const x = cv.getContext('2d', { willReadFrequently: true })!;
    const img = x.getImageData(0, 0, cv.width, cv.height);
    const out = outsideMask(img.data, cv.width, cv.height);
    let n = 0;
    for (let i = 0; i < out.length; i++) if (!out[i] && img.data[i * 4 + 3]! < 8) n++;
    return n;
  };
  const plain = rasterizeText({ ...spec, outlineWidth: 0 });
  const fresh = rasterizeText({ ...spec, counters: 'clear' });
  const rim = rasterizeText({ ...spec, counters: 'rim' });
  const filled = rasterizeText({ ...spec, counters: 'filled' });
  // The old method: centred stroke, then fill on top.
  const old = new OffscreenCanvas(fresh.canvas.width, fresh.canvas.height);
  const o = old.getContext('2d')!;
  o.font = font; o.textAlign = 'center'; o.lineJoin = 'round'; o.lineWidth = 18; o.strokeStyle = '#000'; o.fillStyle = '#fc0';
  o.strokeText(text, fresh.ox, fresh.oy); o.fillText(text, fresh.ox, fresh.oy);
  // Is there still an outline just outside the letters? Look for black pixels.
  const f = fresh.canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, fresh.canvas.width, fresh.canvas.height).data;
  let black = 0, yellow = 0;
  for (let i = 0; i < f.length; i += 4) { if (f[i + 3]! > 200 && f[i]! < 40 && f[i + 1]! < 40) black++; if (f[i + 3]! > 200 && f[i]! > 240 && f[i + 1]! > 180) yellow++; }
  return { trueCounters: enclosed(plain.canvas), oldMethod: enclosed(old), filled: enclosed(filled.canvas), rim: enclosed(rim.canvas), clear: enclosed(fresh.canvas), outlinePixels: black, fillPixels: yellow };
};

/**
 * The audio handed to Whisper: a 75 s chirp (pitch changes continuously, so any offset or gap is obvious) cut into two
 * clips with a 2 s gap, crossing the 30 s mixing-window seam. Returns the 16 kHz mono samples as base64 float32.
 */
window.speechAudio = async () => {
  const lib = new MediaLibrary();
  const blob = await (await fetch('/e2e/.media/chirp.webm')).blob();
  const p = createProject({ fps: 30, width: 320, height: 240 });
  const asset = await lib.importFile(blob, 'chirp.webm', p.fps);
  addClip(p, p.tracks[1]!.id, createClip(asset.id, 0, 1500, 90)); // 50 s starting 3 s into the source
  addClip(p, p.tracks[1]!.id, createClip(asset.id, 1560, 600, 1500)); // 20 s starting 50 s into the source, after a 2 s gap
  const pcm = await renderPcm16k(p, lib);
  const bytes = new Uint8Array(pcm.samples.buffer, pcm.samples.byteOffset, pcm.samples.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { b64: btoa(bin), samples: pcm.samples.length };
};

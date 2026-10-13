import { presetFromAss } from '../src/captions/presets.ts';
import { dialogueToCues, parseAss } from '../src/captions/ass.ts';
import { addClip, createClip, createProject } from '../src/core/timeline.ts';
import { exportProject } from '../src/export/exporter.ts';
import { MediaLibrary } from '../src/media/library.ts';
import { drawVideo } from '../src/render/compose.ts';

declare global { interface Window { run: (opts: { captions: boolean }) => Promise<any>; previewMatchesExport: () => Promise<number> } }

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

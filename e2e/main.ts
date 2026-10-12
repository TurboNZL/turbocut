import { presetFromAss } from '../src/captions/presets.ts';
import { dialogueToCues, parseAss } from '../src/captions/ass.ts';
import { addClip, createClip, createProject } from '../src/core/timeline.ts';
import { exportProject } from '../src/export/exporter.ts';
import { MediaLibrary } from '../src/media/library.ts';

declare global { interface Window { run: (opts: { captions: boolean }) => Promise<any> } }

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

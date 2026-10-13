import 'turbothemes/base.css';
import './styles.css';
import { start } from 'turbothemes';
import { addClip, clipEnd, createClip, newId, projectDuration, removeLinked, splitLinked, trimEnd, trimStart } from '../core/timeline.ts';
import { exportProject } from '../export/exporter.ts';
import { mixWindow } from '../export/audio.ts';
import { drawVideo } from '../render/compose.ts';
import { VideoSampleSink } from 'mediabunny';
import { CaptionsPanel } from './captionsPanel.ts';
import { deviceCheck } from './deviceCheck.ts';
import { dialog, fmtTime, h } from './dom.ts';
import { importFont, loadStoredFonts } from './fonts.ts';
import { Inspector } from './inspector.ts';
import { keepAwake, pickFiles, platform, saveFile } from './platform.ts';
import { Player } from './player.ts';
import { Store } from './store.ts';
import { TimelineView } from './timelineView.ts';

// Phones and some webviews cannot do the Liquid Glass lens; everything else about the look still applies.
const themes = start({ persist: true, picker: true, lens: platform === 'web' || platform === 'electron', appearance: { theme: 'auto', ui: 'auto' } });
void loadStoredFonts();

const store = new Store();
const player = new Player(store);
const timeline = new TimelineView(store, { onUserTouch: () => store.playing && player.pause() });
const inspector = new Inspector(store);
const captions = new CaptionsPanel(store);

// ---------------------------------------------------------------- actions
async function importMedia(files: File[]): Promise<void> {
  for (const file of files) {
    try {
      store.say(`Importing ${file.name}…`);
      const asset = await store.lib.importFile(file, file.name, store.project.fps);
      store.edit((p) => {
        p.assets[asset.id] = asset;
        const v = p.tracks.find((t) => t.kind === 'video')!;
        const a = p.tracks.find((t) => t.kind === 'audio')!;
        const startOf = (t: typeof v) => t.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
        const at = asset.hasVideo ? startOf(v) : startOf(a);
        const link = asset.hasVideo && asset.hasAudio ? newId('l') : undefined;
        if (asset.hasVideo) addClip(p, v.id, { ...createClip(asset.id, at, asset.duration), link });
        if (asset.hasAudio) addClip(p, a.id, { ...createClip(asset.id, at, asset.duration), link });
      });
      store.say(`Imported ${file.name}.`);
    } catch (e) {
      store.say(`Could not open ${file.name}: ${e instanceof Error ? e.message : e}. This device may not support its format.`);
    }
  }
}

function split(): void {
  const p = store.project;
  const f = store.playhead;
  store.edit(() => {
    if (store.selected) splitLinked(p, store.selected, f);
    else for (const t of p.tracks) if (!t.locked) for (const c of [...t.clips]) if (f > c.start && f < clipEnd(c)) splitLinked(p, c.id, f);
  });
}

function remove(ripple: boolean): void {
  if (store.selectedCue) {
    const id = store.selectedCue;
    store.selectedCue = null;
    store.edit((p) => (p.captions = p.captions.filter((c) => c.id !== id)));
    return;
  }
  if (!store.selected) return;
  const id = store.selected;
  store.select(null);
  store.edit((p) => removeLinked(p, id, ripple));
}

function trimToPlayhead(side: 'start' | 'end'): void {
  if (!store.selected) return;
  const id = store.selected;
  store.edit((p) => {
    const group = p.tracks.flatMap((t) => t.clips).filter((c) => c.id === id || (c.link && c.link === p.tracks.flatMap((t) => t.clips).find((x) => x.id === id)?.link));
    for (const c of group) (side === 'start' ? trimStart : trimEnd)(p, c.id, store.playhead);
  });
}

async function runExport(): Promise<void> {
  if (projectDuration(store.project) === 0) return store.say('Nothing to export yet. Import a clip first.');
  player.pause();
  const abort = new AbortController();
  const bar = h('progress', { class: 'prog', max: 1, value: 0 });
  const info = h('p', { class: 'hint' }, 'Rendering at full size. Keep this screen open.');
  const cancel = h('button', { class: 'btn', onclick: () => abort.abort() }, 'Cancel');
  const dlg = dialog('Exporting', h('div', { class: 'stack' }, bar, info), [cancel]);
  const release = await keepAwake();
  try {
    const r = await exportProject(store.project, store.lib, { preset: store.preset, signal: abort.signal, onProgress: (f) => (bar.value = f) });
    const name = `${store.project.name || 'TurboCut'}.${r.container}`;
    bar.value = 1;
    info.textContent = `Done: ${r.videoCodec}${r.audioCodec ? ' + ' + r.audioCodec : ''}, ${(r.data.byteLength / 1e6).toFixed(1)} MB, ${(r.frames / r.seconds).toFixed(1)} frames/s.`;
    await saveFile(new Blob([r.data], { type: r.mime }), name, r.mime);
    store.say(`Exported ${name}.`);
    cancel.textContent = 'Close';
    cancel.onclick = () => dlg.close();
  } catch (e) {
    dlg.close();
    store.say(e instanceof DOMException && e.name === 'AbortError' ? 'Export cancelled.' : `Export failed: ${e instanceof Error ? e.message : e}`);
  } finally {
    release();
  }
}

async function showDeviceCheck(): Promise<void> {
  const pre = h('pre', { class: 'report' }, 'Checking this device…');
  const copy = h('button', { class: 'btn btn-accent', onclick: () => navigator.clipboard?.writeText(pre.textContent ?? '').then(() => store.say('Report copied.')) }, 'Copy report');
  dialog('Device check', pre, [copy]);
  const { project: p } = store;
  pre.textContent = (await deviceCheck(p.width, p.height)).text;
}

function showHelp(): void {
  const rows: [string, string][] = [
    ['Space', 'Play / pause'], ['← →', 'Step one frame (Shift: one second)'], ['Home / End', 'Start / end'],
    ['S', 'Split at playhead (selected clip, or everything under it)'], ['Delete', 'Remove selection'], ['Shift+Delete', 'Remove and close the gap'],
    ['[  ]', 'Trim start / end to playhead'], ['K', 'Keyframe zoom and position here'], ['M', 'Mute selected clip'],
    ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'], ['Ctrl+I', 'Import media'], ['Ctrl+E', 'Export'], ['+ / −', 'Zoom the timeline'],
  ];
  dialog('Shortcuts', h('table', { class: 'keys' }, ...rows.map(([k, d]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, d)))));
}

// ---------------------------------------------------------------- layout
const time = h('span', { class: 'time mono' });
const playBtn = h('button', { class: 'btn btn-accent', 'aria-label': 'Play or pause', onclick: () => player.toggle() }, '▶');
const zoom = h('input', { type: 'range', class: 'bt-range zoom', min: 0.3, max: 12, step: 0.1, value: store.zoom, 'aria-label': 'Timeline zoom' });
const setZoom = (z: number) => {
  store.zoom = Math.min(12, Math.max(0.3, z));
  zoom.value = String(store.zoom);
  store.emit('view');
};
zoom.addEventListener('input', () => setZoom(Number(zoom.value)));
const status = h('div', { class: 'status', role: 'status' });

const tabs: Record<string, HTMLElement> = { Clip: inspector.el, Captions: captions.el, Project: projectPanel() };
const tabBar = h('div', { class: 'tabs bt-tabbar' });
const tabBody = h('div', { class: 'tab-body' });
let activeTab = 'Clip';
const side = h('aside', { class: 'bt-side side collapsed' }, tabBar, tabBody);
function showTab(name: string, userTap = false): void {
  // On a narrow screen the panel is a sheet: tap a tab to open it, tap the open tab again to close it.
  if (userTap && name === activeTab) side.classList.toggle('collapsed');
  else if (userTap) side.classList.remove('collapsed');
  activeTab = name;
  for (const b of tabBar.children) (b as HTMLElement).setAttribute('aria-current', b.textContent === name ? 'page' : 'false');
  tabBody.replaceChildren(tabs[name]!);
}
for (const name of Object.keys(tabs)) tabBar.append(h('button', { class: 'bt-tab', onclick: () => showTab(name, true) }, name));
showTab('Clip');
store.on('selection', () => store.selected && showTab('Clip'));
store.on('selection', () => store.selectedCue && showTab('Captions'));

function projectPanel(): HTMLElement {
  const name = h('input', { class: 'input', value: store.project.name, 'aria-label': 'Project name' });
  name.addEventListener('change', () => (store.project.name = name.value.trim() || 'TurboCut'));
  const aspects: [string, number, number][] = [['Vertical 9:16 (1080×1920)', 1080, 1920], ['Landscape 16:9 (1920×1080)', 1920, 1080], ['Portrait 4:5 (1080×1350)', 1080, 1350], ['Square 1:1 (1080×1080)', 1080, 1080]];
  const aspect = h('select', { class: 'input', 'aria-label': 'Aspect ratio' }, ...aspects.map(([l, w, hh]) => h('option', { value: `${w}x${hh}` }, l)));
  aspect.addEventListener('change', () => {
    const [w, hh] = aspect.value.split('x').map(Number) as [number, number];
    store.edit((p) => ((p.width = w), (p.height = hh)));
  });
  return h('div', { class: 'stack' },
    h('div', { class: 'bt-panel-title' }, 'Project'), name, aspect,
    h('div', { class: 'bt-panel-title' }, 'Look'), Object.assign(document.createElement('turbo-themes-picker'), { variant: 'select' }),
    h('div', { class: 'bt-panel-title' }, 'Help'),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: showHelp }, 'Shortcuts'), h('button', { class: 'btn', onclick: showDeviceCheck }, 'Device check')),
    h('p', { class: 'hint' }, `TurboCut ${platform === 'android' ? 'for Android' : platform === 'electron' ? 'desktop' : 'web'}. Frame rate is ${store.project.fps} fps.`),
  );
}

const header = h('header', { class: 'bt-top top' },
  h('strong', { class: 'logo' }, 'TurboCut'),
  h('button', { class: 'btn', onclick: async () => importMedia(await pickFiles('video/*,audio/*,.mkv,.webm,.mov', true)) }, 'Import'),
  h('button', { class: 'btn', 'aria-label': 'Undo', title: 'Undo (Ctrl+Z)', onclick: () => store.undo() }, '↶'),
  h('button', { class: 'btn', 'aria-label': 'Redo', title: 'Redo (Ctrl+Shift+Z)', onclick: () => store.redo() }, '↷'),
  h('span', { class: 'spacer' }),
  h('button', { class: 'btn btn-accent', onclick: runExport }, 'Export'),
);

const transport = h('div', { class: 'transport' },
  h('button', { class: 'btn', 'aria-label': 'Start', onclick: () => store.seek(0) }, '⏮'),
  playBtn,
  h('button', { class: 'btn', 'aria-label': 'End', onclick: () => store.seek(projectDuration(store.project)) }, '⏭'),
  time,
);

// Edit actions live in one bar right under the timeline, in thumb reach on a phone.
const editBar = h('div', { class: 'edit-bar' },
  h('button', { class: 'btn btn-accent', onclick: split, title: 'Split at the playhead (S)' }, 'Split'),
  h('button', { class: 'btn', onclick: () => trimToPlayhead('start'), title: 'Cut the start of the selected clip to the playhead ([)' }, 'Trim start'),
  h('button', { class: 'btn', onclick: () => trimToPlayhead('end'), title: 'Cut the end of the selected clip to the playhead (])' }, 'Trim end'),
  h('button', { class: 'btn', onclick: () => remove(false), title: 'Delete the selection' }, 'Delete'),
  h('span', { class: 'spacer' }),
  h('button', { class: 'btn', 'aria-label': 'Zoom out timeline', onclick: () => setZoom(store.zoom / 1.5) }, '−'),
  zoom,
  h('button', { class: 'btn', 'aria-label': 'Zoom in timeline', onclick: () => setZoom(store.zoom * 1.5) }, '+'),
);

player.canvas.addEventListener('click', () => player.toggle());
const stage = h('section', { class: 'stage' }, h('div', { class: 'preview' }, player.canvas), transport);
const app = document.getElementById('app')!;
app.append(header, h('main', { class: 'main' }, stage, side), h('section', { class: 'bottom' }, timeline.el), editBar, status);

const tick = () => {
  const p = store.project;
  time.textContent = `${fmtTime(store.playhead, p.fps)} / ${fmtTime(projectDuration(p), p.fps)}`;
};
store.on('playhead', tick);
store.on('project', tick);
store.on('play', () => (playBtn.textContent = store.playing ? '⏸' : '▶'));
store.on('status', () => (status.textContent = store.status));
tick();
store.say('Import a clip to start. Press ? for shortcuts.');

// ---------------------------------------------------------------- shortcuts and drop
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('input, textarea, select, [contenteditable]')) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key;
  const handled = (() => {
    if (mod && k.toLowerCase() === 'z') return e.shiftKey ? (store.redo(), true) : (store.undo(), true);
    if (mod && k.toLowerCase() === 'y') return (store.redo(), true);
    if (mod && k.toLowerCase() === 'i') return (pickFiles('video/*,audio/*,.mkv,.webm,.mov', true).then(importMedia), true);
    if (mod && k.toLowerCase() === 'e') return (void runExport(), true);
    if (mod || e.altKey) return false;
    switch (k) {
      case ' ': return (player.toggle(), true);
      case 'ArrowLeft': return (store.seek(store.playhead - (e.shiftKey ? store.project.fps : 1)), true);
      case 'ArrowRight': return (store.seek(store.playhead + (e.shiftKey ? store.project.fps : 1)), true);
      case 'Home': return (store.seek(0), true);
      case 'End': return (store.seek(projectDuration(store.project)), true);
      case 's': case 'S': return (split(), true);
      case 'Delete': case 'Backspace': return (remove(e.shiftKey), true);
      case '[': return (trimToPlayhead('start'), true);
      case ']': return (trimToPlayhead('end'), true);
      case 'k': case 'K': return (inspector.keyframeAll(), true);
      case 'm': case 'M': return (store.selected && store.edit((p) => { for (const t of p.tracks) for (const c of t.clips) if (c.id === store.selected) c.muted = !c.muted; }), true);
      case '+': case '=': return (setZoom(store.zoom * 1.25), true);
      case '-': case '_': return (setZoom(store.zoom / 1.25), true);
      case '?': return (showHelp(), true);
    }
    return false;
  })();
  if (handled) e.preventDefault();
});

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /^(video|audio)\//.test(f.type) || /\.(mkv|mov|webm|mp4|m4a|mp3|wav|ogg)$/i.test(f.name));
  if (files.length) void importMedia(files);
});

// Exposed so tests and automation can drive the editor without synthesising pointer input.
async function exportForTest() {
  const r = await exportProject(store.project, store.lib, { preset: store.preset });
  const bytes = new Uint8Array(r.data);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { container: r.container, videoCodec: r.videoCodec, audioCodec: r.audioCodec, bytes: bytes.length, frames: r.frames, seconds: r.seconds, b64: btoa(bin) };
}

/** Test hooks for memory profiling: run only the video path, or only the audio path. */
async function probeVideo(frames: number) {
  const p = store.project;
  const feed = store.lib.sequential(p, 0);
  const ctx = new OffscreenCanvas(p.width, p.height).getContext('2d')!;
  for (let f = 0; f < frames; f++) await drawVideo(ctx, p, f, feed);
  feed.dispose?.();
}
async function probeDecode(kind: 'samples' | 'draw' | 'bitmap960' | 'bitmap1920', frames: number) {
  const o = (store.lib as any).opened.values().next().value;
  const sink = new VideoSampleSink(o.video);
  const ctx = new OffscreenCanvas(1080, 1920).getContext('2d')!;
  let n = 0;
  for await (const sample of sink.samples(0, frames / 30)) {
    if (kind === 'draw') sample.draw(ctx, 0, 0, 1080, 1920);
    else if (kind === 'bitmap960' || kind === 'bitmap1920') {
      const frame = sample.toVideoFrame();
      const bmp = await createImageBitmap(frame, { resizeWidth: kind === 'bitmap960' ? 960 : 1920, resizeQuality: 'medium' });
      frame.close();
      ctx.drawImage(bmp, 0, 0, 1080, 1920);
      bmp.close();
    }
    sample.close();
    if (++n >= frames) break;
  }
}
async function probeAudio(seconds: number) {
  for (let t = 0; t < seconds; t += 6) await mixWindow(store.project, store.lib, t, t + 6);
}

(window as any).turbocutApp = { store, player, themes, importMedia, importFont, runExport, split, exportForTest, probeVideo, probeAudio, probeDecode };

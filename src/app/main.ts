import 'turbothemes/base.css';
import './styles.css';
import './motion.css';
import { start } from 'turbothemes';
import { projectDuration } from '../core/timeline.ts';
import { exportProject } from '../export/exporter.ts';
import { mixWindow } from '../export/audio.ts';
import { drawVideo } from '../render/compose.ts';
import { VideoSampleSink } from 'mediabunny';
import { Actions } from './actions.ts';
import { BinPanel } from './binPanel.ts';
import { CaptionsPanel } from './captionsPanel.ts';
import { fmtTime, h, panel, popupMenu } from './dom.ts';
import { importFont, loadStoredFonts } from './fonts.ts';
import { Hotkeys, type HotkeyAction } from './hotkeys.ts';
import { openHome } from './home.ts';
import { Inspector } from './inspector.ts';
import { applyLayout, findLayout, type TabName } from './layout.ts';
import { KeysPanel } from './keysPanel.ts';
import { icon, setIcon } from './icons.ts';
import { pickFiles, platform } from './platform.ts';
import { Player } from './player.ts';
import { openSettings, capturingKey, type SettingsTab } from './settingsDialog.ts';
import { Store, ZOOM_MAX, ZOOM_MIN } from './store.ts';
import { TimelineView } from './timelineView.ts';
import { checkForUpdate } from './updater.ts';

// Phones and some webviews cannot do the Liquid Glass lens; everything else about the look still applies.
const themes = start({ persist: true, picker: true, lens: platform === 'web' || platform === 'electron', appearance: { theme: 'auto', ui: 'auto' } });
void loadStoredFonts();

const store = new Store();
const player = new Player(store);
const actions = new Actions(store, player);
const timeline = new TimelineView(store, {
  onUserTouch: () => store.playing && player.pause(),
  trackActions: { toggle: (id, what) => actions.toggleTrack(id, what), remove: (id) => actions.removeTrack(id) },
});
const inspector = new Inspector(store);
const captions = new CaptionsPanel(store);
const keys = new KeysPanel(store, (dir) => inspector.jumpKey(dir));
const hotkeys = new Hotkeys(() => store.settings.hotkeys, (o) => store.updateSettings({ hotkeys: o }));
const touch = timeline.touch;
const settings = (tab?: SettingsTab) => openSettings({ store, hotkeys, touch }, tab);
captions.openEngineSettings = () => settings('Captions');

const importFiles = async () => actions.importMedia(await pickFiles('video/*,audio/*,.mkv,.webm,.mov', true));
const bin = new BinPanel(store, actions, timeline, () => void importFiles());

// ---------------------------------------------------------------- shortcuts (the person can change all of these in Settings)
const act = (group: string, id: string, label: string, keys: string[], run: HotkeyAction['run']): HotkeyAction => ({ id, label, group, keys, run });
hotkeys.register([
  act('Playback', 'play', 'Play or pause', ['Space'], () => player.toggle()),
  act('Playback', 'stepBack', 'One frame back', ['ArrowLeft'], () => actions.step(-1)),
  act('Playback', 'stepForward', 'One frame forward', ['ArrowRight'], () => actions.step(1)),
  act('Playback', 'secBack', 'One second back', ['Shift+ArrowLeft'], () => actions.step(-store.project.fps)),
  act('Playback', 'secForward', 'One second forward', ['Shift+ArrowRight'], () => actions.step(store.project.fps)),
  act('Playback', 'toStart', 'Go to the start', ['Home'], () => store.seek(0)),
  act('Playback', 'toEnd', 'Go to the end', ['End'], () => store.seek(projectDuration(store.project))),
  act('Editing', 'split', 'Split at the playhead', ['S'], () => actions.split()),
  act('Editing', 'delete', 'Delete the selection', ['Delete', 'Backspace'], () => actions.remove(false)),
  act('Editing', 'rippleDelete', 'Delete and close the gap', ['Shift+Delete', 'Shift+Backspace'], () => actions.remove(true)),
  act('Editing', 'trimStart', 'Trim the start to the playhead', ['['], () => actions.trimToPlayhead('start')),
  act('Editing', 'trimEnd', 'Trim the end to the playhead', [']'], () => actions.trimToPlayhead('end')),
  act('Editing', 'mute', 'Mute the selected clip', ['M'], () => actions.toggleMute()),
  act('Editing', 'keyframe', 'Keyframe zoom and position here', ['K'], () => inspector.keyframeAll()),
  act('Editing', 'prevKey', 'Jump to the previous keyframe', [','], () => inspector.jumpKey(-1)),
  act('Editing', 'nextKey', 'Jump to the next keyframe', ['.'], () => inspector.jumpKey(1)),
  act('Editing', 'addText', 'Add a text layer', ['T'], () => actions.addText()),
  act('Editing', 'undo', 'Undo', ['Ctrl+Z'], () => store.undo()),
  act('Editing', 'redo', 'Redo', ['Ctrl+Shift+Z', 'Ctrl+Y'], () => store.redo()),
  act('Timeline', 'snap', 'Turn snapping on or off', ['N'], () => actions.toggleSnapping()),
  act('Timeline', 'zoomIn', 'Zoom the timeline in', ['+', '='], () => store.setZoom(store.zoom * 1.25)),
  act('Timeline', 'zoomOut', 'Zoom the timeline out', ['-', '_'], () => store.setZoom(store.zoom / 1.25)),
  act('File', 'import', 'Import media', ['Ctrl+I'], () => void importFiles()),
  act('File', 'save', 'Save the project as a file', ['Ctrl+S'], () => void actions.saveProject()),
  act('File', 'open', 'Open a project file', ['Ctrl+O'], () => actions.openProject()),
  act('File', 'new', 'New project', ['Ctrl+N'], () => actions.newProject()),
  act('File', 'export', 'Export', ['Ctrl+E'], () => void actions.runExport()),
  act('App', 'settings', 'Open Settings', ['Ctrl+,'], () => settings()),
  act('App', 'shortcuts', 'Show the shortcut list', ['?'], () => settings('Keys')),
]);

// ---------------------------------------------------------------- layout
const time = h('span', { class: 'time mono' });
const playBtn = h('button', { class: 'btn btn-accent', 'aria-label': 'Play or pause', onclick: () => player.toggle() }, icon('play'));
const lnMin = Math.log(ZOOM_MIN);
const lnMax = Math.log(ZOOM_MAX);
const zoom = h('input', { type: 'range', class: 'bt-range zoom', min: lnMin, max: lnMax, step: 0.01, value: Math.log(store.zoom), 'aria-label': 'Timeline zoom' });
zoom.addEventListener('input', () => store.setZoom(Math.exp(Number(zoom.value))));
store.on('view', () => (zoom.value = String(Math.log(store.zoom))));
const status = h('div', { class: 'status', role: 'status' });

const tabs: Record<string, HTMLElement> = { Clip: h('div', { class: 'clip-tab' }, inspector.el, keys.el), Media: bin.el, Captions: captions.el, Project: projectPanel() };
const tabBar = h('div', { class: 'tabs', role: 'tablist' });
const tabBody = h('div', { class: 'tab-body' });
let activeTab = 'Clip';
const side = h('aside', { class: 'bt-side side collapsed' }, tabBar, tabBody);
function showTab(name: string, userTap = false): void {
  // On a narrow screen the panel is a sheet: tap a tab to open it, tap the open tab again to close it.
  if (userTap && name === activeTab) side.classList.toggle('collapsed');
  else if (userTap) side.classList.remove('collapsed');
  activeTab = name;
  for (const b of tabBar.children) (b as HTMLElement).setAttribute('aria-selected', String(b.textContent === name));
  tabBody.replaceChildren(tabs[name]!);
  if (userTap) swap(tabs[name]!);
}
/** Replay the swap animation on an element (a class that is already there does nothing until it is removed and the page has laid out). */
function swap(el: HTMLElement, cls = 'tk-swap'): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}
showTab('Clip');
/** Draw the chosen layout: panel side and size, timeline height, control size and which panel tabs show. */
const narrowQuery = matchMedia('(max-width: 820px)');
const touchQuery = matchMedia('(pointer: coarse)');
function drawLayout(): void {
  const l = applyLayout(findLayout(store.settings.layout, store.settings.layouts), narrowQuery.matches, touchQuery.matches);
  app.dataset.panel = l.panel;
  app.dataset.density = l.density;
  app.style.setProperty('--panel-w', `${l.panelWidth}px`);
  app.style.setProperty('--tl-h', `${l.timelineHeight}%`);
  tabBar.replaceChildren(...l.tabs.map((name) => h('button', { class: 'tab', role: 'tab', onclick: () => showTab(name, true) }, name)));
  if (!l.tabs.includes(activeTab as TabName)) showTab(l.tabs[0]!);
  else showTab(activeTab);
}
store.on('settings', drawLayout);
narrowQuery.addEventListener('change', drawLayout);
touchQuery.addEventListener('change', drawLayout);
// Switch panels only when a DIFFERENT clip or caption gets selected. Undo, redo and picking a track also announce a
// selection change; they must not pull the person out of the panel they are working in.
let lastSelected: string | null = null;
let lastCue: string | null = null;
store.on('selection', () => {
  if (store.selected && store.selected !== lastSelected) showTab('Clip');
  if (store.selectedCue && store.selectedCue !== lastCue) showTab('Captions');
  lastSelected = store.selected;
  lastCue = store.selectedCue;
});

function projectPanel(): HTMLElement {
  const name = h('input', { class: 'input', 'aria-label': 'Project name' });
  name.addEventListener('change', () => store.edit((p) => (p.name = name.value.trim() || 'Untitled')));
  const aspects: [string, number, number][] = [['Vertical 9:16 (1080×1920)', 1080, 1920], ['Landscape 16:9 (1920×1080)', 1920, 1080], ['Portrait 4:5 (1080×1350)', 1080, 1350], ['Square 1:1 (1080×1080)', 1080, 1080]];
  const aspect = h('select', { class: 'input', 'aria-label': 'Aspect ratio' }, ...aspects.map(([l, w, hh]) => h('option', { value: `${w}x${hh}` }, l)), h('option', { value: 'custom', hidden: true }, 'Custom size'));
  aspect.addEventListener('change', () => {
    const [w, hh] = aspect.value.split('x').map(Number) as [number, number];
    store.edit((p) => ((p.width = w), (p.height = hh)));
  });
  const rate = h('p', { class: 'hint' });
  const missing = h('button', { class: 'btn', onclick: () => actions.relinkDialog() }, 'Find missing media…');
  const sync = () => {
    const p = store.project;
    if (document.activeElement !== name) name.value = p.name;
    aspect.value = aspects.some(([, w, hh]) => w === p.width && hh === p.height) ? `${p.width}x${p.height}` : 'custom';
    rate.textContent = `Frame rate is ${p.fps} fps.`;
    missing.hidden = store.missingAssets().length === 0;
  };
  store.on('project', sync);
  sync();
  return panel(
    'Project',
    name,
    aspect,
    rate,
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => void actions.saveProject() }, 'Save…'), h('button', { class: 'btn', onclick: () => actions.openProject() }, 'Open…'), h('button', { class: 'btn', onclick: () => actions.newProject() }, 'New')),
    missing,
    h('p', { class: 'hint' }, 'A project file holds the edit, not the video. Keep the media files next to it.'),
    h('button', { class: 'btn', onclick: () => settings() }, 'Settings…'),
  );
}

const iconBtn = (name: string, label: string, run: () => void, extra = '') => h('button', { class: `btn btn-ghost icon-btn ${extra}`.trim(), 'aria-label': label, title: label, onclick: run }, icon(name));
const fileMenu = h('button', { class: 'btn btn-ghost', 'aria-haspopup': 'menu' }, 'File', icon('chevron', 14));
fileMenu.addEventListener('click', () =>
  popupMenu(fileMenu, [
    { label: 'New project', run: () => actions.newProject() },
    { label: 'Open project…', run: () => actions.openProject() },
    { label: 'Save project', run: () => void actions.saveProject() },
    { label: 'Import media…', run: () => void importFiles() },
    { label: 'Find missing media…', run: () => actions.relinkDialog(), disabled: store.missingAssets().length === 0 },
  ]),
);
const header = h('header', { class: 'bt-top top' },
  h('img', { class: 'logo-mark', src: `${import.meta.env.BASE_URL}favicon.svg`, alt: '', width: 22, height: 22 }),
  h('strong', { class: 'logo' }, 'TurboCut'),
  iconBtn('home', 'Home', () => showHome()),
  fileMenu,
  h('span', { class: 'spacer' }),
  iconBtn('undo', 'Undo (Ctrl+Z)', () => store.undo()),
  iconBtn('redo', 'Redo (Ctrl+Shift+Z)', () => store.redo()),
  iconBtn('settings', 'Settings (Ctrl+,)', () => settings()),
  h('button', { class: 'btn btn-accent', onclick: () => void actions.runExport() }, 'Export'),
);

const transport = h('div', { class: 'transport' },
  iconBtn('skipBack', 'Go to the start', () => store.seek(0)),
  playBtn,
  iconBtn('skipForward', 'Go to the end', () => store.seek(projectDuration(store.project))),
  time,
);

// Edit actions live in one bar right under the timeline, in thumb reach on a phone.
const snapBtn = h('button', { class: 'btn btn-ghost tool', 'aria-label': 'Snapping', title: 'Snapping (N)', onclick: () => actions.toggleSnapping() }, icon('magnet'));
const syncSnap = () => {
  snapBtn.setAttribute('aria-pressed', String(store.settings.snapping));
  snapBtn.classList.toggle('on', store.settings.snapping);
};
store.on('settings', syncSnap);
syncSnap();
/** A tool: an icon, with its name beside it on a wide screen (the label hides on a phone, the tooltip and aria-label stay). */
const tool = (name: string, label: string, tip: string, run: () => void, cls = 'btn-ghost') => h('button', { class: `btn ${cls} tool`, 'aria-label': label, title: tip, onclick: run }, icon(name), h('span', { class: 'tool-l' }, label));
const editBar = h('div', { class: 'edit-bar' },
  tool('split', 'Split', 'Split at the playhead (S)', () => actions.split(), 'btn-accent'),
  tool('trimStart', 'Trim start', 'Cut the start of the selected clip to the playhead ([)', () => actions.trimToPlayhead('start')),
  tool('trimEnd', 'Trim end', 'Cut the end of the selected clip to the playhead (])', () => actions.trimToPlayhead('end')),
  tool('trash', 'Delete', 'Delete the selection', () => actions.remove(false)),
  tool('text', 'Text', 'Add a text layer (T)', () => actions.addText()),
  snapBtn,
  h('button', {
    class: 'btn btn-ghost tool',
    'aria-label': 'Add a track',
    title: 'Add a track',
    onclick: (e: Event) => popupMenu(e.currentTarget as HTMLElement, [{ label: 'Add a video track', run: () => actions.addTrack('video') }, { label: 'Add an audio track', run: () => actions.addTrack('audio') }]),
  }, icon('plus'), h('span', { class: 'tool-l' }, 'Track')),
  h('span', { class: 'spacer' }),
  h('span', { class: 'zoom-box' },
    iconBtn('minus', 'Zoom out timeline', () => store.setZoom(store.zoom / 1.5)),
    zoom,
    iconBtn('plus', 'Zoom in timeline', () => store.setZoom(store.zoom * 1.5))),
);

player.canvas.addEventListener('click', () => player.toggle());
const stage = h('section', { class: 'stage' }, h('div', { class: 'preview' }, player.canvas), transport);
const app = document.getElementById('app')!;
app.append(header, h('main', { class: 'main' }, stage, side), h('section', { class: 'bottom' }, timeline.el), editBar, status);
drawLayout();

/** The home screen: shown when the app starts with nothing in the project (unless switched off), and from the Home button. */
let homeOpen = false;
function showHome(): void {
  if (homeOpen) return;
  homeOpen = true;
  openHome({ store, importFiles, openProject: () => actions.openProject(), openSettings: (tab) => settings(tab), onClose: () => (homeOpen = false) });
}
if (store.settings.showHome && projectDuration(store.project) === 0) showHome();

const tick = () => {
  const p = store.project;
  time.textContent = `${fmtTime(store.playhead, p.fps)} / ${fmtTime(projectDuration(p), p.fps)}`;
};
store.on('playhead', tick);
store.on('project', tick);
store.on('play', () => setIcon(playBtn, store.playing ? 'pause' : 'play'));
let toastTimer: ReturnType<typeof setTimeout> | undefined;
store.on('status', () => {
  status.textContent = store.status;
  status.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => status.classList.remove('show'), 4500);
});
tick();
store.say('Import a clip to start. Press ? for shortcuts.');

// ---------------------------------------------------------------- keyboard and drop
window.addEventListener('keydown', (e) => {
  if (capturingKey) return; // the shortcut editor is listening
  const t = e.target as HTMLElement;
  if (t.closest('input, textarea, select, [contenteditable]')) return;
  if (document.querySelector('.dlg-backdrop') && e.key !== 'Escape' && !(e.ctrlKey || e.metaKey)) return; // a dialog is open
  if (hotkeys.handle(e)) e.preventDefault();
});

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /^(video|audio)\//.test(f.type) || /\.(mkv|mov|webm|mp4|m4a|mp3|wav|ogg|turbocut)$/i.test(f.name));
  if (files.length) void actions.dropFiles(files);
});

// ---------------------------------------------------------------- update check on start (at most every 6 hours, never blocks)
const CHECKED = 'turbocut.updateChecked';
setTimeout(async () => {
  try {
    if (!store.settings.autoCheckUpdates) return;
    if (Date.now() - Number(localStorage.getItem(CHECKED) ?? 0) < 6 * 3600_000) return;
    localStorage.setItem(CHECKED, String(Date.now()));
    const st = await checkForUpdate();
    if (st.newer && st.latest) store.say(`TurboCut ${st.latest.version} is available. Open Settings, then Updates.`);
  } catch {
    /* offline or rate limited: try again next start */
  }
}, 4000);

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

(window as any).turbocutApp = { store, player, themes, actions, hotkeys, settings, importFont, importMedia: (f: File[]) => actions.importMedia(f), runExport: () => actions.runExport(), split: () => actions.split(), exportForTest, probeVideo, probeAudio, probeDecode };

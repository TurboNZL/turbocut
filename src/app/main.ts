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
import { Hotkeys, prettyCombo, type HotkeyAction } from './hotkeys.ts';
import { rememberProject } from './recent.ts';
import { openHome } from './home.ts';
import { Inspector } from './inspector.ts';
import { applyLayout, LIMITS, type Side, type TabName } from './layout.ts';
import { activeLayout, editLayout } from './layoutStore.ts';
import { Dock, type View } from './dock.ts';
import { windowFrame } from './windowFrame.ts';
import { PanelHost } from './panelHost.ts';
import { splitter } from './splitter.ts';
import { icon, setIcon, type IconName } from './icons.ts';
import { pickFiles, platform } from './platform.ts';
import { Player } from './player.ts';
import { openSettings, capturingKey, settingsView, type SettingsTab } from './settingsDialog.ts';
import { Store, ZOOM_MAX, ZOOM_MIN } from './store.ts';
import { detectSystemFonts, fontPermission } from './systemFonts.ts';
import { TimelineView } from './timelineView.ts';
import { checkForUpdate } from './updater.ts';
import { enhanceSelects } from './themedSelect.ts';
import { openTwitchImport } from './twitchDialog.ts';
import { openSendDialog, startSharing } from './share.ts';

// Phones and some webviews cannot do the Liquid Glass lens; everything else about the look still applies.
const themes = start({ persist: true, picker: true, lens: platform === 'web' || platform === 'electron', appearance: { theme: 'auto', ui: 'auto' } });
void loadStoredFonts();
enhanceSelects(); // every drop-down is drawn by the theme, never the system's own list
// Installed fonts: the desktop app lists them straight away (no prompt in Electron); a browser only if the person already allowed it.
void (async () => {
  if (platform === 'electron' || (await fontPermission()) === 'granted') await detectSystemFonts();
})();

const store = new Store();
const player = new Player(store);
const actions = new Actions(store, player);
const timeline = new TimelineView(store, {
  actions,
  onUserTouch: () => store.playing && player.pause(),
  trackActions: { toggle: (id, what) => actions.toggleTrack(id, what), remove: (id) => actions.removeTrack(id), add: (kind) => actions.addTrack(kind) },
});
const inspector = new Inspector(store);
const captions = new CaptionsPanel(store);
const hotkeys = new Hotkeys(() => store.settings.hotkeys, (o) => store.updateSettings({ hotkeys: o }));
const touch = timeline.touch;

/** Settings: a page of its own with the bottom dock, otherwise a window. */
const settings = (tab?: SettingsTab) => {
  if (store.settings.dock) setView('settings', tab);
  else openSettings({ store, hotkeys, touch }, tab);
};
captions.openEngineSettings = () => settings('Captions');

/** Pick media into the bin. Resolves true when files were chosen (a cancelled picker is false, so a screen that asked is not left). */
const importFiles = async (folder?: string): Promise<boolean> => {
  const files = await pickFiles('video/*,audio/*,.mkv,.webm,.mov', true);
  if (!files.length) return false;
  await actions.importMedia(files, false, folder);
  showTab('Media'); // imported files wait in the bin: show it, so it is clear where they went
  return true;
};
const bin = new BinPanel(store, actions, timeline, (folder) => void importFiles(folder), () => openTwitchImport(actions));

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
  act('Editing', 'selectAll', 'Select every clip', ['Ctrl+A'], () => store.selectAllClips()),
  act('Editing', 'duplicate', 'Duplicate the selected clips', ['Ctrl+D'], () => actions.duplicateSelection()),
  act('Editing', 'deselect', 'Select nothing', ['Escape'], () => !document.querySelector('.dlg-backdrop, .popup-menu') && store.clearSelection()),
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
  act('File', 'open', 'Open a project file', ['Ctrl+O'], () => void actions.openProject()),
  act('File', 'new', 'New project', ['Ctrl+N'], () => void actions.newProject()),
  act('File', 'export', 'Export', ['Ctrl+E'], () => void actions.runExport()),
  act('App', 'settings', 'Open Settings', ['Ctrl+,'], () => settings()),
  act('App', 'shortcuts', 'Show the shortcut list', ['?'], () => settings('Keys')),
]);

/**
 * Tooltips that show the shortcut in force right now, not the default: a button's title is its name plus whatever keys the
 * person has set (and it is rewritten whenever the shortcuts change).
 */
const tips: { el: HTMLElement; text: string; id: string }[] = [];
const writeTip = (t: { el: HTMLElement; text: string; id: string }) => {
  const keys = hotkeys.keysFor(t.id).slice(0, 2).map(prettyCombo);
  t.el.title = keys.length ? `${t.text} (${keys.join(' or ')})` : t.text;
};
function keyTip<T extends HTMLElement>(el: T, text: string, id: string): T {
  const t = { el, text, id };
  tips.push(t);
  writeTip(t);
  return el;
}
store.on('settings', () => tips.forEach(writeTip));

// ---------------------------------------------------------------- layout
const time = h('span', { class: 'time mono' });
const playBtn = keyTip(h('button', { class: 'btn btn-accent', 'aria-label': 'Play or pause', onclick: () => player.toggle() }, icon('play')), 'Play or pause', 'play');
const lnMin = Math.log(ZOOM_MIN);
const lnMax = Math.log(ZOOM_MAX);
const zoom = h('input', { type: 'range', class: 'bt-range zoom', min: lnMin, max: lnMax, step: 0.01, value: Math.log(store.zoom), 'aria-label': 'Timeline zoom' });
zoom.addEventListener('input', () => store.setZoom(Math.exp(Number(zoom.value))));
store.on('view', () => (zoom.value = String(Math.log(store.zoom))));
const status = h('div', { class: 'status', role: 'status' });

// The panel's tabs are built once; the panel host moves them between panes as the layout says.
const tabs: Record<TabName, HTMLElement> = { Clip: h('div', { class: 'clip-tab' }, inspector.el), Media: bin.el, Captions: captions.el, Project: projectPanel() };
const dock = new Dock((v) => setView(v));
const colVar = (side: Side) => (side === 'left' ? '--left-w' : '--right-w');
const host: PanelHost = new PanelHost(
  tabs,
  {
    getWidth: (side) => parseFloat(app.style.getPropertyValue(colVar(side))) || (side === 'left' ? activeLayout(store).leftWidth : activeLayout(store).panelWidth),
    setWidth: (side, px, commit) => {
      app.style.setProperty(colVar(side), `${px}px`);
      if (commit) editLayout(store, side === 'left' ? { leftWidth: px } : { panelWidth: px });
    },
    setSizes: (side, sizes, commit) => {
      if (!commit) return;
      const divisions = activeLayout(store).divisions.map((d) => ({ ...d, tabs: [...d.tabs] }));
      divisions.filter((d) => d.side === side).forEach((d, i) => (d.size = sizes[i] ?? d.size));
      editLayout(store, { divisions });
    },
    resetSizes: () => editLayout(store, { panelWidth: 340, leftWidth: 300, divisions: activeLayout(store).divisions.map((d) => ({ ...d, tabs: [...d.tabs], size: 0 })) }),
  },
  store.settings.openTab,
);
host.onShow = () => {};
const showTab = (name: TabName, userTap = false) => host.show(name, userTap);
/** Draw the chosen layout: panel columns and sizes, timeline height, where the tools go, control size, the dock. */
const narrowQuery = matchMedia('(max-width: 820px)');
const touchQuery = matchMedia('(pointer: coarse)');
function drawLayout(): void {
  const l = applyLayout(activeLayout(store), narrowQuery.matches, touchQuery.matches);
  app.dataset.panel = l.mode === 'sheet' ? 'sheet' : l.right.length && !l.left.length ? 'right' : l.left.length && !l.right.length ? 'left' : 'both';
  app.dataset.density = l.density;
  app.dataset.tools = l.tools; // inline with the play button, a row under it, under the timeline, or floating
  app.dataset.dock = store.settings.dock ? 'on' : 'off';
  app.style.setProperty('--left-w', `${l.left.length ? l.leftWidth : 0}px`);
  app.style.setProperty('--right-w', `${l.right.length ? l.panelWidth : 0}px`);
  app.style.setProperty('--left-on', l.left.length ? '1' : '0');
  app.style.setProperty('--right-on', l.right.length ? '1' : '0');
  app.style.setProperty('--tl-h', `${l.timelineHeight}%`);
  host.setStart(store.settings.openTab);
  host.apply(l);
  placeTools(l.tools);
  if (!store.settings.dock && view !== 'edit') {
    // The dock was switched off while a dock page was open: leave that page (Settings becomes its window).
    const was = view;
    setView('edit');
    if (was === 'settings') openSettings({ store, hotkeys, touch }, 'Look');
  }
  dock.render(store.settings.dock, view);
}
store.on('settings', drawLayout);
narrowQuery.addEventListener('change', drawLayout);
touchQuery.addEventListener('change', drawLayout);
// Switch panels only when a DIFFERENT clip or caption gets selected. Undo, redo and picking a track also announce a
// selection change; they must not pull the person out of the panel they are working in. (Settings can turn this off.)
let lastSelected: string | null = null;
let lastCue: string | null = null;
store.on('selection', () => {
  if (store.settings.autoSwitch) {
    if (store.selected && store.selected !== lastSelected) showTab('Clip');
    if (store.selectedCue && store.selectedCue !== lastCue) showTab('Captions');
  }
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
    h('div', { class: 'proj' },
      h('label', { class: 'proj-field' }, h('span', { class: 'prop-l' }, 'Name'), name),
      h('label', { class: 'proj-field' }, h('span', { class: 'prop-l' }, 'Shape'), aspect),
      rate,
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => void actions.saveProject() }, 'Save…'), h('button', { class: 'btn', onclick: () => void actions.openProject() }, 'Open…'), h('button', { class: 'btn', onclick: () => void actions.newProject() }, 'New')),
      missing,
      h('p', { class: 'hint' }, 'A project file holds the edit, not the video. Keep the media files next to it.'),
      h('button', { class: 'btn', onclick: () => openSendDialog(store) }, 'Send to another device…'),
      h('button', { class: 'btn', onclick: () => settings() }, 'Settings…')),
  );
}

const iconBtn = (name: IconName, label: string, run: () => void, extra = '', hotkey?: string) => {
  const b = h('button', { class: `btn btn-ghost icon-btn ${extra}`.trim(), 'aria-label': label, title: label, onclick: run }, icon(name));
  return hotkey ? keyTip(b, label, hotkey) : b;
};
const fileMenu = h('button', { class: 'btn btn-ghost', 'aria-haspopup': 'menu' }, 'File', icon('chevron', 14));
fileMenu.addEventListener('click', () =>
  popupMenu(fileMenu, [
    { label: 'New project', run: () => void actions.newProject() },
    { label: 'Open project…', run: () => void actions.openProject() },
    { label: 'Save project', run: () => void actions.saveProject() },
    { label: 'Import media…', run: () => void importFiles() },
    { label: 'Import a Twitch clip…', run: () => openTwitchImport(actions) },
    { label: 'Send to another device…', run: () => openSendDialog(store) },
    { label: 'Find missing media…', run: () => actions.relinkDialog(), disabled: store.missingAssets().length === 0 },
  ]),
);
const header = h('header', { class: 'bt-top top' },
  h('img', { class: 'logo-mark', src: `${import.meta.env.BASE_URL}icon.svg`, alt: '', width: 28, height: 28 }),
  h('strong', { class: 'logo' }, 'TurboCut'),
  iconBtn('home', 'Home', () => (store.settings.dock ? setView('home') : showHome()), 'hdr-home'),
  fileMenu,
  h('span', { class: 'spacer' }),
  iconBtn('undo', 'Undo', () => store.undo(), '', 'undo'),
  iconBtn('redo', 'Redo', () => store.redo(), '', 'redo'),
  iconBtn('settings', 'Settings', () => settings(), '', 'settings'),
  keyTip(h('button', { class: 'btn btn-accent', onclick: () => void actions.runExport() }, 'Export'), 'Export', 'export'),
);

const transportMain = h('div', { class: 'transport-main' },
  iconBtn('skipBack', 'Go to the start', () => store.seek(0), '', 'toStart'),
  playBtn,
  iconBtn('skipForward', 'Go to the end', () => store.seek(projectDuration(store.project)), '', 'toEnd'),
  time,
);
const transport = h('div', { class: 'transport' }, transportMain);

// The editing tools. One bar, moved to where the layout wants it (see `placeTools`): in line with the play button, a row under it,
// under the timeline, in a column beside the preview, or as round buttons floating at the bottom right.
const snapBtn = keyTip(h('button', { class: 'btn btn-ghost tool', 'aria-label': 'Snapping', onclick: () => actions.toggleSnapping() }, icon('magnet')), 'Snapping', 'snap');
const syncSnap = () => {
  snapBtn.setAttribute('aria-pressed', String(store.settings.snapping));
  snapBtn.classList.toggle('on', store.settings.snapping);
};
store.on('settings', syncSnap);
syncSnap();
/** A tool: an icon, with its name beside it on a wide screen (the label hides on a phone, the tooltip and aria-label stay). */
const tool = (name: IconName, label: string, tip: string, id: string, run: () => void, cls = 'btn-ghost') => keyTip(h('button', { class: `btn ${cls} tool`, 'aria-label': label, onclick: run }, icon(name), h('span', { class: 'tool-l' }, label)), tip, id);
const fabToggle = h('button', { class: 'btn btn-accent tool fab-toggle', 'aria-label': 'Show or hide the editing tools', 'aria-expanded': 'true', title: 'Show or hide the editing tools' }, icon('more'));
const editBar = h('div', { class: 'edit-bar', 'data-open': '' },
  fabToggle,
  // Split sits between the two trim buttons: trim the start, cut here, trim the end.
  tool('trimStart', 'Trim start', 'Cut the start of the selected clip to the playhead', 'trimStart', () => actions.trimToPlayhead('start')),
  tool('split', 'Split', 'Split at the playhead', 'split', () => actions.split(), 'btn-accent'),
  tool('trimEnd', 'Trim end', 'Cut the end of the selected clip to the playhead', 'trimEnd', () => actions.trimToPlayhead('end')),
  tool('trash', 'Delete', 'Delete the selection', 'delete', () => actions.remove(false)),
  tool('text', 'Text', 'Add a text layer', 'addText', () => actions.addText()),
  snapBtn,
  h('span', { class: 'spacer' }),
  h('span', { class: 'zoom-box' },
    iconBtn('minus', 'Zoom out timeline', () => store.setZoom(store.zoom / 1.5), '', 'zoomOut'),
    zoom,
    iconBtn('plus', 'Zoom in timeline', () => store.setZoom(store.zoom * 1.5), '', 'zoomIn')),
);
fabToggle.addEventListener('click', () => {
  const open = editBar.hasAttribute('data-open');
  if (open) editBar.removeAttribute('data-open');
  else editBar.setAttribute('data-open', '');
  fabToggle.setAttribute('aria-expanded', String(!open));
});
/** Put the tool bar where the layout wants it. Moving the same element keeps its listeners and state. */
function placeTools(where: 'inline' | 'stage' | 'bottom' | 'left' | 'right' | 'float'): void {
  const dest = where === 'inline' ? transport : where === 'stage' || where === 'left' || where === 'right' ? stage : app;
  if (editBar.parentElement !== dest) dest.append(editBar);
}

player.canvas.addEventListener('click', () => player.toggle());
const stage = h('section', { class: 'stage' }, h('div', { class: 'preview' }, player.canvas), transport);
const app = document.getElementById('app')!;
const frameBar = windowFrame();
if (frameBar) app.before(frameBar);
// The bar between the preview and the timeline: drag to give the timeline more or less of the window.
let tlStart = 0;
const timelineBar = splitter({
  axis: 'y',
  label: 'Resize the timeline',
  extraClass: 'splitter-timeline',
  onStart: () => (tlStart = bottomEl.offsetHeight),
  onDrag: (dy) => app.style.setProperty('--tl-h', `${Math.min(LIMITS.timelineHeight[1], Math.max(LIMITS.timelineHeight[0], ((tlStart - dy) / app.clientHeight) * 100)).toFixed(1)}%`),
  onEnd: () => editLayout(store, { timelineHeight: Math.round(parseFloat(app.style.getPropertyValue('--tl-h'))) }),
  onReset: () => editLayout(store, { timelineHeight: 34 }),
});
const bottomEl = h('section', { class: 'bottom' }, timelineBar, timeline.el);
const [leftSide, rightSide] = host.els as [HTMLElement, HTMLElement];
app.append(header, h('main', { class: 'main' }, leftSide, stage, rightSide), bottomEl, dock.el, status);

// ---------------------------------------------------------------- the three places of the bottom dock: Home, Edit and Settings
let view: View = 'edit';
let homeEl: HTMLElement | null = null;
let settingsLayer: HTMLElement | null = null;
let settingsPage: ReturnType<typeof settingsView> | null = null;
function leaveHome(): void {
  homeEl?.remove();
  homeEl = null;
}
function leaveSettings(): void {
  settingsLayer?.remove();
  settingsLayer = null;
  settingsPage = null;
}
/** Go to a page of the dock (with the dock on). Edit is the editor itself; Home and Settings are pages above it, above the dock. */
function setView(next: View, tab?: SettingsTab): void {
  if (next !== 'home') leaveHome();
  if (next !== 'settings') leaveSettings();
  view = next;
  if (next === 'home' && !homeEl) showHome();
  if (next === 'settings') {
    if (!settingsLayer) {
      settingsPage = settingsView({ store, hotkeys, touch }, tab ?? 'General');
      settingsLayer = h('div', { class: 'view-layer', 'aria-label': 'Settings' }, settingsPage.el);
      document.body.append(settingsLayer);
    } else if (tab) settingsPage?.show(tab);
    settingsPage?.focusSearch();
  }
  dock.render(store.settings.dock, view);
  if (next === 'edit') bootAnimation();
}
/** The parts of the editor arrive one after another when it opens (and again when the home screen is closed). */
function bootAnimation(): void {
  app.classList.add('booting');
  window.setTimeout(() => app.classList.remove('booting'), 1100);
}

/** The home screen: shown when the app starts with nothing in the project (unless switched off), and from the Home button. */
function showHome(): void {
  if (homeEl) return;
  const docked = store.settings.dock;
  if (docked) view = 'home';
  const handle = openHome({
    store,
    importFiles: () => importFiles(),
    openProject: () => actions.openProject(),
    openRecent: (key) => actions.openRecent(key),
    openSettings: (tab) => settings(tab),
    docked,
    onClose: () => {
      homeEl = null;
      if (store.settings.dock) setView('edit');
      else bootAnimation();
    },
  });
  homeEl = handle.el;
  dock.render(store.settings.dock, view);
}
drawLayout();
startSharing(store, actions); // desktop app: be found by other TurboCut apps and accept what they send (each time, with an Accept)
if (store.settings.showHome && projectDuration(store.project) === 0) showHome();
else bootAnimation();

// Work is kept in the recent list a few seconds after the last change, so a project that was never saved to a file is still one tap away.
let keepTimer: ReturnType<typeof setTimeout> | undefined;
store.on('project', () => {
  clearTimeout(keepTimer);
  keepTimer = setTimeout(() => void rememberProject(store.project), 4000);
});
window.addEventListener('pagehide', () => void rememberProject(store.project));

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

// importMedia places the first clip into an empty timeline here, as older tests expect; the app itself never places an import.
(window as any).turbocutApp = { store, player, themes, actions, detectSystemFonts, hotkeys, settings, importFont, importMedia: (f: File[], place?: boolean) => actions.importMedia(f, place ?? store.project.tracks.every((t) => t.clips.length === 0)), runExport: () => actions.runExport(), split: () => actions.split(), exportForTest, probeVideo, probeAudio, probeDecode };

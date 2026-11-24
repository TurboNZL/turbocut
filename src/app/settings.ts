import type { Compute } from '../transcribe/local.ts';
import { BALANCED_MODEL, MODELS, recommendedModel } from '../transcribe/local.ts';
import { AUTO_LAYOUT, TAB_NAMES, cleanLayout, type Layout, type TabName } from './layout.ts';

export type CounterMode = 'filled' | 'rim' | 'clear';

export interface TranscribeSettings {
  /** Language name or code for Whisper, blank to detect. English by default: detection can pick the wrong language. */
  lang: string;
  model: string;
  compute: Compute;
  /** The person has picked a model (in the first-use window or in Settings). Until then Generate captions asks first. */
  modelChosen: boolean;
  /** How long each caption is: `auto` is short lines for tall video and whole sentences for wide video. */
  grouping: CaptionGrouping;
}

export type CaptionGrouping = 'auto' | 'short' | 'sentence';

/** How sharp the preview is drawn: a share of the project's size. `auto` follows the device (half on a phone, full elsewhere). */
export type PreviewScale = 'auto' | 100 | 75 | 50 | 25;
/** How many frames the preview draws a second while playing: a share of the project's rate. `auto` is half of a 50 or 60 fps project on a touch screen, every frame elsewhere. */
export type PreviewFps = 'auto' | 'full' | 'half' | 'third' | 'quarter';
export const PREVIEW_SCALES: PreviewScale[] = ['auto', 100, 75, 50, 25];
export const PREVIEW_FPS: PreviewFps[] = ['auto', 'full', 'half', 'third', 'quarter'];

/** The three kinds of row in the timeline. */
export type TrackGroup = 'captions' | 'video' | 'audio';
export const TRACK_GROUPS: TrackGroup[] = ['video', 'audio', 'captions'];

/** The colours and UI style, mirrored from the theme engine so a config file can carry them. */
export interface Look {
  theme: string;
  ui: string;
  glass?: 'regular' | 'clear';
  wallpaper?: boolean;
  wallpaperDarkness?: number;
}

export const UI_SCALE = { min: 80, max: 150 } as const;

export interface Settings {
  /** 2: the letter-hole default became 'filled'; older stored 'rim' values came from the old default and are upgraded once. 3: the preview frame rate became 'auto'; a stored 'full' from before was the old default. */
  settingsVersion: number;
  /** Clips and edges jump to the playhead and to each other when dragged close. */
  snapping: boolean;
  /** Draw a low-detail waveform inside audio clips. */
  waveforms: boolean;
  /** The order the kinds of track are drawn in, top to bottom: the caption row, the video tracks and the audio tracks. */
  trackOrder: TrackGroup[];
  /** Keep a copy of imported media inside TurboCut (browser and phone) so a saved project finds its files again by itself. */
  rememberMedia: boolean;
  /** Android: where a new project is saved. `app` is TurboCut's own storage (the default), `personal` is Documents/TurboCut, which other apps and a computer can see. The desktop app keeps this choice in the shell. */
  saveIn: 'app' | 'personal';
  /** How big the whole interface is, in percent (100 = normal). */
  uiScale: number;
  /** Colour theme and UI style (kept by the theme engine; mirrored here so config files carry them). */
  look: Look;
  /** Download newer themes from the internet in the background. Off by default: the themes inside the app are the ones it was tested with, and a download replaces them. */
  themeUpdates: boolean;
  /** The first-run setup has been finished or skipped. */
  onboarded: boolean;
  /** Font for new caption styles, new text layers and the built-in caption style. */
  defaultFont: string;
  /** What the holes of letters look like in new styles. */
  counters: CounterMode;
  /** Name of the active editor layout (built in or one of `layouts`). */
  layout: string;
  /** The person's own layouts. */
  layouts: Layout[];
  autoCheckUpdates: boolean;
  /** Show the home screen when the app starts with an empty project. */
  showHome: boolean;
  /** Write edits to the project's file a few seconds after each change (only once the project has been saved somewhere). */
  autosave: boolean;
  /** The bottom dock with Home, Edit and Settings (a window-level choice, not part of a layout). */
  dock: boolean;
  /** Let other TurboCut apps on the network find this one and send it projects (desktop apps; each transfer still needs an Accept). */
  shareEnabled: boolean;
  /** How this device is named to the others; blank is the computer's own name. */
  deviceName: string;
  /** The panel tab that opens first (Media unless changed). */
  openTab: TabName;
  /** Jump to the Clip tab when a clip is selected and to Captions when a caption is. */
  autoSwitch: boolean;
  previewScale: PreviewScale;
  previewFps: PreviewFps;
  transcribe: TranscribeSettings;
  /** Shortcuts the person changed: action id to key combos. Anything not here uses the default. */
  hotkeys: Record<string, string[]>;
}

export const DEFAULT_SETTINGS = (touch: boolean): Settings => ({
  settingsVersion: 3,
  snapping: true,
  waveforms: !touch, // a phone has less to spare
  trackOrder: [...TRACK_GROUPS],
  rememberMedia: true,
  saveIn: 'app',
  uiScale: 100,
  look: { theme: 'auto', ui: 'auto' },
  themeUpdates: false,
  onboarded: false,
  defaultFont: 'Arial Black',
  counters: 'filled',
  layout: AUTO_LAYOUT,
  layouts: [],
  autoCheckUpdates: true,
  showHome: true,
  autosave: true,
  dock: false,
  shareEnabled: true,
  deviceName: '',
  openTab: 'Media',
  autoSwitch: true,
  previewScale: 'auto',
  previewFps: 'auto',
  transcribe: { lang: 'english', model: recommendedModel(touch), compute: 'auto', modelChosen: false, grouping: 'auto' },
  hotkeys: {},
});

const KEY = 'turbocut.settings';

/** Merge stored values over the defaults, keeping only values of the right type so old or broken data cannot break the app. */
export function mergeSettings(stored: unknown, defaults: Settings): Settings {
  const out: Settings = structuredClone(defaults);
  if (!stored || typeof stored !== 'object') return out;
  const s = stored as Record<string, any>;
  for (const k of ['snapping', 'waveforms', 'rememberMedia', 'autoCheckUpdates', 'showHome', 'autosave', 'dock', 'autoSwitch', 'shareEnabled', 'themeUpdates', 'onboarded'] as const) if (typeof s[k] === 'boolean') out[k] = s[k];
  if (typeof s.uiScale === 'number' && Number.isFinite(s.uiScale)) out.uiScale = Math.min(UI_SCALE.max, Math.max(UI_SCALE.min, Math.round(s.uiScale)));
  if (s.look && typeof s.look === 'object' && typeof s.look.theme === 'string' && typeof s.look.ui === 'string' && s.look.theme.length < 60 && s.look.ui.length < 60) {
    const l: Look = { theme: s.look.theme, ui: s.look.ui };
    if (s.look.glass === 'regular' || s.look.glass === 'clear') l.glass = s.look.glass;
    if (typeof s.look.wallpaper === 'boolean') l.wallpaper = s.look.wallpaper;
    if (typeof s.look.wallpaperDarkness === 'number' && s.look.wallpaperDarkness >= 0 && s.look.wallpaperDarkness <= 0.9) l.wallpaperDarkness = s.look.wallpaperDarkness;
    out.look = l;
  }
  if (s.saveIn === 'app' || s.saveIn === 'personal') out.saveIn = s.saveIn;
  // The row order: a list with each kind once. Older settings only said whether video sat above audio.
  if (Array.isArray(s.trackOrder) && s.trackOrder.length === 3 && TRACK_GROUPS.every((g) => s.trackOrder.includes(g))) out.trackOrder = [...s.trackOrder];
  else if (typeof s.videoOnTop === 'boolean') out.trackOrder = s.videoOnTop ? ['video', 'audio', 'captions'] : ['audio', 'video', 'captions'];
  if (typeof s.defaultFont === 'string' && s.defaultFont.trim()) out.defaultFont = s.defaultFont.trim();
  if (s.counters === 'filled' || s.counters === 'rim' || s.counters === 'clear') out.counters = s.counters === 'rim' && !(s.settingsVersion >= 2) ? 'filled' : s.counters;
  if (Array.isArray(s.layouts)) out.layouts = s.layouts.map((l: unknown) => cleanLayout(l)).filter((l: Layout | null): l is Layout => !!l).slice(0, 30);
  if (typeof s.layout === 'string') out.layout = s.layout;
  // The dock used to be a layout ("Bottom dock"); it is a setting now.
  if (typeof s.dock !== 'boolean' && (s.layout === 'Bottom dock' || (Array.isArray(s.layouts) && s.layouts.some((l: any) => l?.name === s.layout && l?.dock === true)))) out.dock = true;
  if (typeof s.deviceName === 'string') out.deviceName = s.deviceName.trim().slice(0, 60);
  if ((TAB_NAMES as readonly string[]).includes(s.openTab)) out.openTab = s.openTab;
  if (PREVIEW_SCALES.includes(s.previewScale)) out.previewScale = s.previewScale;
  // Before version 3 'full' was the default, not a choice: it made phones draw every frame of a 60 fps project.
  if (PREVIEW_FPS.includes(s.previewFps)) out.previewFps = s.previewFps === 'full' && !(s.settingsVersion >= 3) ? 'auto' : s.previewFps;
  if (s.transcribe && typeof s.transcribe === 'object') {
    const t = s.transcribe;
    for (const k of ['lang', 'model'] as const) if (typeof t[k] === 'string') out.transcribe[k] = t[k];
    if (t.grouping === 'auto' || t.grouping === 'short' || t.grouping === 'sentence') out.transcribe.grouping = t.grouping;
    if (typeof t.modelChosen === 'boolean') out.transcribe.modelChosen = t.modelChosen;
    // Settings saved before the first-use window existed: a model other than the old default was a choice, the old default was not.
    else if (typeof t.model === 'string' && MODELS.some((m) => m.id === t.model) && t.model !== BALANCED_MODEL) out.transcribe.modelChosen = true;
    if (!out.transcribe.modelChosen && t.model === BALANCED_MODEL) out.transcribe.model = defaults.transcribe.model; // the old default is replaced by today's recommendation
    if (t.compute === 'auto' || t.compute === 'webgpu' || t.compute === 'wasm') out.transcribe.compute = t.compute;
  }
  if (s.hotkeys && typeof s.hotkeys === 'object') {
    for (const [id, keys] of Object.entries(s.hotkeys)) if (Array.isArray(keys) && keys.every((x) => typeof x === 'string')) out.hotkeys[id] = keys as string[];
  }
  return out;
}

export function loadSettings(touch: boolean): Settings {
  try {
    return mergeSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null'), DEFAULT_SETTINGS(touch));
  } catch {
    return DEFAULT_SETTINGS(touch);
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage may be blocked; settings then last for this session only */
  }
}

/** Settings as a shareable file (no access tokens). */
export function exportSettings(s: Settings): string {
  const copy = structuredClone(s);
  return JSON.stringify({ format: 'turbocut.settings', version: 1, settings: copy }, null, 2);
}

export function importSettings(json: string, defaults: Settings): Settings {
  const data = JSON.parse(json);
  if (data?.format !== 'turbocut.settings') throw new Error('Not a TurboCut settings file');
  return mergeSettings(data.settings, defaults);
}

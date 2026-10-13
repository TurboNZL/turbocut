import type { Compute } from '../transcribe/local.ts';
import { MODELS } from '../transcribe/local.ts';
import { AUTO_LAYOUT, cleanLayout, type Layout } from './layout.ts';

export type CounterMode = 'filled' | 'rim' | 'clear';

export interface TranscribeSettings {
  mode: 'local' | 'remote';
  url: string;
  token: string;
  /** Language name or code for Whisper, blank to detect. English by default: detection can pick the wrong language. */
  lang: string;
  model: string;
  compute: Compute;
}

export interface Settings {
  /** 2: the letter-hole default became 'filled'; older stored 'rim' values came from the old default and are upgraded once. */
  settingsVersion: number;
  /** Clips and edges jump to the playhead and to each other when dragged close. */
  snapping: boolean;
  /** Draw a low-detail waveform inside audio clips. */
  waveforms: boolean;
  /** Video tracks above audio tracks in the timeline (otherwise audio above video). */
  videoOnTop: boolean;
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
  transcribe: TranscribeSettings;
  /** Shortcuts the person changed: action id to key combos. Anything not here uses the default. */
  hotkeys: Record<string, string[]>;
}

export const DEFAULT_SETTINGS = (touch: boolean): Settings => ({
  settingsVersion: 2,
  snapping: true,
  waveforms: !touch, // a phone has less to spare
  videoOnTop: true,
  defaultFont: 'Arial Black',
  counters: 'filled',
  layout: AUTO_LAYOUT,
  layouts: [],
  autoCheckUpdates: true,
  showHome: true,
  transcribe: { mode: 'local', url: '', token: '', lang: 'english', model: MODELS[0].id, compute: 'auto' },
  hotkeys: {},
});

const KEY = 'turbocut.settings';

/** Merge stored values over the defaults, keeping only values of the right type so old or broken data cannot break the app. */
export function mergeSettings(stored: unknown, defaults: Settings): Settings {
  const out: Settings = structuredClone(defaults);
  if (!stored || typeof stored !== 'object') return out;
  const s = stored as Record<string, any>;
  for (const k of ['snapping', 'waveforms', 'videoOnTop', 'autoCheckUpdates', 'showHome'] as const) if (typeof s[k] === 'boolean') out[k] = s[k];
  if (typeof s.defaultFont === 'string' && s.defaultFont.trim()) out.defaultFont = s.defaultFont.trim();
  if (s.counters === 'filled' || s.counters === 'rim' || s.counters === 'clear') out.counters = s.counters === 'rim' && s.settingsVersion !== 2 ? 'filled' : s.counters;
  if (Array.isArray(s.layouts)) out.layouts = s.layouts.map((l: unknown) => cleanLayout(l)).filter((l: Layout | null): l is Layout => !!l).slice(0, 30);
  if (typeof s.layout === 'string') out.layout = s.layout;
  if (s.transcribe && typeof s.transcribe === 'object') {
    const t = s.transcribe;
    if (t.mode === 'local' || t.mode === 'remote') out.transcribe.mode = t.mode;
    for (const k of ['url', 'token', 'lang', 'model'] as const) if (typeof t[k] === 'string') out.transcribe[k] = t[k];
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
  copy.transcribe.token = '';
  return JSON.stringify({ format: 'turbocut.settings', version: 1, settings: copy }, null, 2);
}

export function importSettings(json: string, defaults: Settings): Settings {
  const data = JSON.parse(json);
  if (data?.format !== 'turbocut.settings') throw new Error('Not a TurboCut settings file');
  return mergeSettings(data.settings, defaults);
}

import { DEFAULT_SETTINGS, mergeSettings, type Settings } from './settings.ts';

/**
 * A settings file ("config") as a list of single settings, so a person can see what is in it, take out the ones they forgot they changed,
 * and apply the rest here or on another device. Pure functions over `Settings`; the Settings → Config page is the face of it.
 *
 * A config holds only the settings that were chosen, in the same shape as the stored settings. Reading one validates every value the way
 * stored settings are validated (`mergeSettings`), so a wrong or hand-edited value is dropped, not trusted.
 */
export const CONFIG_FORMAT = 'turbocut.config';
export const CONFIG_EXT = '.conf';

export interface ConfigEntry {
  /** `snapping`, `transcribe.model`, `hotkeys.split`, `layouts.My layout`. */
  path: string;
  group: string;
  label: string;
  value: unknown;
  /** The value in words, for the list. */
  text: string;
}

const SCALARS: [string, string, string][] = [
  ['General', 'snapping', 'Snap clips and edges'],
  ['General', 'waveforms', 'Show audio waveforms'],
  ['General', 'trackOrder', 'Order of the timeline rows'],
  ['General', 'previewScale', 'Preview sharpness'],
  ['General', 'previewFps', 'Preview frame rate'],
  ['General', 'showHome', 'Show the home screen at start'],
  ['General', 'autosave', 'Keep the project file up to date'],
  ['General', 'rememberMedia', 'Keep a copy of imported media'],
  ['General', 'autoCheckUpdates', 'Check for updates at start'],
  ['Look', 'dock', 'Bottom dock'],
  ['Layout', 'layout', 'Active layout'],
  ['Layout', 'openTab', 'Tab that opens first'],
  ['Layout', 'autoSwitch', 'Jump to Clip or Captions on selection'],
  ['Fonts', 'defaultFont', 'Default font'],
  ['Fonts', 'counters', 'Letter holes'],
  ['Device', 'shareEnabled', 'Let other TurboCut apps find this device'],
  ['Device', 'deviceName', 'Name shown to other devices'],
];
const TRANSCRIBE: [string, string][] = [
  ['lang', 'Caption language'],
  ['model', 'Speech model'],
  ['compute', 'Processor for captions'],
  ['grouping', 'Caption length'],
];

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const words = (v: unknown): string => {
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (Array.isArray(v)) return v.map(String).join(', ') || 'none';
  if (v === '') return 'blank';
  return String(v);
};

/** Every single setting of `s` with its current value. */
export function entriesOf(s: Settings): ConfigEntry[] {
  const out: ConfigEntry[] = [];
  for (const [group, key, label] of SCALARS) {
    const value = (s as unknown as Record<string, unknown>)[key];
    out.push({ path: key, group, label, value, text: key === 'trackOrder' ? (value as string[]).join(' above ') : words(value) });
  }
  for (const [key, label] of TRANSCRIBE) {
    const value = (s.transcribe as unknown as Record<string, unknown>)[key];
    out.push({ path: `transcribe.${key}`, group: 'Captions', label, value, text: words(value) });
  }
  for (const [id, keys] of Object.entries(s.hotkeys)) out.push({ path: `hotkeys.${id}`, group: 'Keys', label: `Shortcut ${id}`, value: keys, text: words(keys) });
  for (const l of s.layouts) out.push({ path: `layouts.${l.name}`, group: 'Layout', label: `Layout "${l.name}"`, value: l, text: 'your own layout' });
  return out;
}

/** The settings that differ from the defaults: what a person has actually changed. */
export function changedEntries(s: Settings, defaults: Settings = DEFAULT_SETTINGS(false)): ConfigEntry[] {
  const base = new Map(entriesOf(defaults).map((e) => [e.path, e.value]));
  return entriesOf(s).filter((e) => !base.has(e.path) || !same(base.get(e.path), e.value));
}

/** Set one setting by its path. */
export function setEntry(s: Settings, path: string, value: unknown): void {
  const [head, ...rest] = path.split('.');
  const key = rest.join('.');
  const t = s as unknown as Record<string, any>;
  if (head === 'transcribe') t.transcribe[key] = value;
  else if (head === 'hotkeys') t.hotkeys[key] = value;
  else if (head === 'layouts') {
    const i = s.layouts.findIndex((l) => l.name === key);
    if (i >= 0) s.layouts[i] = value as Settings['layouts'][number];
    else s.layouts.push(value as Settings['layouts'][number]);
  } else t[path] = value;
}

/** The text of a config file holding exactly these settings. */
export function configText(entries: ConfigEntry[]): string {
  const partial: Record<string, any> = {};
  for (const e of entries) {
    const [head, ...rest] = e.path.split('.');
    const key = rest.join('.');
    if (head === 'transcribe') (partial.transcribe ??= {})[key] = e.value;
    else if (head === 'hotkeys') (partial.hotkeys ??= {})[key] = e.value;
    else if (head === 'layouts') (partial.layouts ??= []).push(e.value);
    else partial[e.path] = e.value;
  }
  return JSON.stringify({ format: CONFIG_FORMAT, version: 1, savedWith: 'TurboCut', settings: partial }, null, 2);
}

/** Read a config file. Throws a sentence when it is not one. Returns the settings it carries, checked, as a partial. */
export function readConfig(json: string): Record<string, unknown> {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('That file is not a TurboCut config (it is not valid JSON).');
  }
  // The older "Export settings" file carried every setting under another tag: it reads the same way.
  if (!data || (data.format !== CONFIG_FORMAT && data.format !== 'turbocut.settings') || typeof data.settings !== 'object' || !data.settings) throw new Error('That file is not a TurboCut config.');
  if (data.version !== 1) throw new Error('This config was saved by a newer TurboCut. Update the app to read it.');
  return data.settings;
}

/**
 * What applying a config would change on `current`: the settings it carries whose value differs from the one in use, each with the value
 * now (`before`). Values are validated; a layout of the same name is replaced, other layouts stay.
 */
export function previewConfig(current: Settings, partial: Record<string, unknown>): { next: Settings; changes: { entry: ConfigEntry; before: string }[] } {
  const p: Record<string, any> = { ...partial, settingsVersion: DEFAULT_SETTINGS(false).settingsVersion };
  if (Array.isArray(p.layouts)) {
    const byName = new Map(current.layouts.map((l) => [l.name, l as unknown]));
    const incoming = mergeSettings({ layouts: p.layouts }, DEFAULT_SETTINGS(false)).layouts;
    for (const l of incoming) byName.set(l.name, l);
    p.layouts = [...byName.values()];
  }
  const next = mergeSettings(p, current);
  const was = new Map(entriesOf(current).map((e) => [e.path, e]));
  const changes = entriesOf(next)
    .filter((e) => !same(was.get(e.path)?.value, e.value))
    .map((e) => ({ entry: e, before: was.get(e.path)?.text ?? 'not set' }));
  return { next, changes };
}

/** `current` with just the chosen settings taken over from `next`. */
export function applyChosen(current: Settings, next: Settings, chosen: Set<string>): Settings {
  const out = structuredClone(current);
  const from = new Map(entriesOf(next).map((e) => [e.path, e]));
  for (const path of chosen) {
    const e = from.get(path);
    if (!e) continue;
    setEntry(out, path, structuredClone(e.value));
    if (path === 'transcribe.model') out.transcribe.modelChosen = true; // a config that names a model is a choice: Generate need not ask again
  }
  return out;
}

/** Defaults with only these settings on top: what "apply this config to this instance" makes of the device. */
export function settingsFrom(entries: ConfigEntry[], defaults: Settings): Settings {
  const out = structuredClone(defaults);
  for (const e of entries) setEntry(out, e.path, structuredClone(e.value));
  if (entries.some((e) => e.path === 'transcribe.model')) out.transcribe.modelChosen = true;
  return out;
}

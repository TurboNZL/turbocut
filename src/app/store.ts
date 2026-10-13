import type { CaptionPreset } from '../captions/presets.ts';
import { createProject } from '../core/timeline.ts';
import type { Frame, Project } from '../core/types.ts';
import { MediaLibrary } from '../media/library.ts';
import { BUILTIN_PRESET } from './builtin.ts';
import { loadSettings, saveSettings, type Settings } from './settings.ts';

export type Topic = 'project' | 'playhead' | 'selection' | 'play' | 'view' | 'status' | 'preset' | 'settings';

/** Timeline zoom limits in pixels per frame: from a whole 20 minute edit on a phone to single frames. */
export const ZOOM_MIN = 0.02;
export const ZOOM_MAX = 40;

const PRESETS_KEY = 'turbocut.presets';
const ACTIVE_KEY = 'turbocut.preset.active';

function readPresets(): CaptionPreset[] {
  try {
    const list = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** All editor state in one place. The UI subscribes to topics and re-renders the part that changed. */
export class Store {
  project: Project = createProject({ name: 'Untitled', fps: 30, width: 1080, height: 1920 });
  lib = new MediaLibrary();
  selected: string | null = null;
  selectedCue: string | null = null;
  playhead: Frame = 0;
  playing = false;
  /** Timeline zoom in CSS pixels per frame. */
  zoom = 3;
  status = '';
  settings: Settings = loadSettings(typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  presets: CaptionPreset[] = [BUILTIN_PRESET, ...readPresets()];
  preset: CaptionPreset = this.presets.find((p) => p.name === localStorage.getItem(ACTIVE_KEY)) ?? BUILTIN_PRESET;

  private subs = new Map<Topic, Set<() => void>>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  on(topic: Topic, fn: () => void): void {
    (this.subs.get(topic) ?? this.subs.set(topic, new Set()).get(topic)!).add(fn);
  }

  emit(...topics: Topic[]): void {
    for (const t of topics) this.subs.get(t)?.forEach((fn) => fn());
  }

  /** Change the project. Records an undo step first. */
  edit(fn: (p: Project) => void): void {
    this.undoStack.push(JSON.stringify(this.project));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    fn(this.project);
    this.emit('project');
  }

  /** Like `edit`, but one undo step for a whole drag: call `begin()` once, then mutate freely. */
  begin(): void {
    this.undoStack.push(JSON.stringify(this.project));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(prev);
    this.afterHistory();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(next);
    this.afterHistory();
  }

  private afterHistory(): void {
    const ids = new Set(this.project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
    if (this.selected && !ids.has(this.selected)) this.selected = null;
    this.emit('project', 'selection');
  }

  /** Change settings (and keep them). */
  updateSettings(patch: Partial<Settings> | ((s: Settings) => void)): void {
    if (typeof patch === 'function') patch(this.settings);
    else Object.assign(this.settings, patch);
    saveSettings(this.settings);
    this.emit('settings');
  }

  setZoom(z: number): void {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    this.emit('view');
  }

  seek(frame: Frame): void {
    this.playhead = Math.max(0, Math.round(frame));
    this.emit('playhead');
  }

  select(id: string | null): void {
    this.selected = id;
    this.emit('selection');
  }

  say(message: string): void {
    this.status = message;
    this.emit('status');
  }

  setPreset(p: CaptionPreset, remember = true): void {
    this.preset = p;
    this.project.captionPreset = p.name;
    if (remember) {
      if (!this.presets.some((x) => x.name === p.name)) this.presets.push(p);
      else this.presets = this.presets.map((x) => (x.name === p.name ? p : x));
      try {
        localStorage.setItem(PRESETS_KEY, JSON.stringify(this.presets.filter((x) => x !== BUILTIN_PRESET)));
        localStorage.setItem(ACTIVE_KEY, p.name);
      } catch {
        /* storage may be blocked; the preset still works this session */
      }
    }
    this.emit('preset');
  }
}

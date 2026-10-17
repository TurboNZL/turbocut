import { cueAt, findCue, splitCue } from '../core/captions.ts';
import { matchMedia, parseProject, projectFileName, serializeProject } from '../core/projectFile.ts';
import { addClip, createProject, addTrack, clipEnd, createClip, findClip, findFreeStart, newId, projectDuration, removeLinked, removeTrack, splitLinked, trimEnd, trimStart } from '../core/timeline.ts';
import type { Track } from '../core/types.ts';
import { overlaps } from '../core/timeline.ts';
import { exportProject } from '../export/exporter.ts';
import { dialog, h } from './dom.ts';
import { keepAwake, pickFiles, saveFile } from './platform.ts';
import type { Player } from './player.ts';
import { CAPTION_TRACK, type Store } from './store.ts';

/** Everything the person can do to the project, as plain functions the buttons, shortcuts and tests all call. */
export class Actions {
  constructor(private store: Store, private player: Player) {}

  /**
   * Open files into the media bin (into `folder` when given). Nothing is put on the timeline: files wait in the bin
   * until the person adds them (pass `place` to add them straight away, for tests and automation).
   */
  async importMedia(files: File[], place = false, folder?: string): Promise<void> {
    const { store } = this;
    for (const file of files) {
      try {
        store.say(`Importing ${file.name}…`);
        const asset = await store.lib.importFile(file, file.name, store.project.fps);
        if (folder && store.project.folders?.some((f) => f.id === folder)) asset.folder = folder;
        store.edit((p) => (p.assets[asset.id] = asset));
        if (place) this.addAsset(asset.id);
        store.say(place ? `Imported ${file.name}.` : `${file.name} is in the media bin. Add it to the timeline from there.`);
      } catch (e) {
        store.say(`Could not open ${file.name}: ${e instanceof Error ? e.message : e}. This device may not support its format.`);
      }
    }
  }

  // ---------------------------------------------------------------- project files

  /** Save the edit as a `.turbocut` file (the media stays where it is). */
  async saveProject(): Promise<void> {
    const { store } = this;
    const name = projectFileName(store.project.name);
    await saveFile(serializeProject(store.project), name, 'application/json');
    store.dirty = false;
    store.say(`Saved ${name}. It holds the edit, not the video: keep the media files too.`);
  }

  /** Ask before throwing away unsaved work, then run `go`. */
  guardUnsaved(go: () => void): void {
    if (!this.store.dirty) return go();
    const dlg = dialog('Unsaved changes', h('p', {}, 'This project has changes that are not saved to a file.'), [
      h('button', { class: 'btn btn-accent', onclick: () => void this.saveProject().then(() => (dlg.close(), go())) }, 'Save, then continue'),
      h('button', { class: 'btn', onclick: () => (dlg.close(), go()) }, 'Discard them'),
      h('button', { class: 'btn btn-ghost', onclick: () => dlg.close() }, 'Cancel'),
    ]);
  }

  /** A fresh project at the same size. */
  newProject(): void {
    this.guardUnsaved(() => {
      const { width, height } = this.store.project;
      this.store.loadProject(createProject({ name: 'Untitled', width, height }));
      this.store.say('New project.');
    });
  }

  /** Open a `.turbocut` file (picked, or the one given). The media is asked for afterwards. */
  openProject(file?: File): void {
    this.guardUnsaved(() => void this.loadProjectFile(file));
  }

  private async loadProjectFile(file?: File): Promise<void> {
    const { store } = this;
    const f = file ?? (await pickFiles('.turbocut,.json,application/json'))[0];
    if (!f) return;
    try {
      store.loadProject(parseProject(await f.text()));
    } catch (e) {
      store.say(`Could not open ${f.name}: ${e instanceof Error ? e.message : e}`);
      return;
    }
    const missing = store.missingAssets();
    store.say(missing.length ? `Opened ${f.name}. ${missing.length} media file${missing.length === 1 ? '' : 's'} to find.` : `Opened ${f.name}.`);
    if (missing.length) this.relinkDialog();
  }

  /** Give media entries without a file their files again, matched by name (and size). Returns how many were found. */
  async relinkMedia(files: File[]): Promise<number> {
    const { store } = this;
    const missing = store.missingAssets();
    const found = matchMedia(missing, files);
    let n = 0;
    for (const [id, i] of found) {
      const file = files[i]!;
      try {
        await store.lib.relink(id, file, file.name);
        const a = store.project.assets[id]!;
        if (a.size === undefined) a.size = file.size;
        n++;
      } catch (e) {
        store.say(`Could not open ${file.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (n) store.emit('project');
    return n;
  }

  /** Lists the media a loaded project is missing and lets the person pick the files. */
  relinkDialog(): void {
    const { store } = this;
    const list = h('ul', { class: 'relink-list' });
    const note = h('p', { class: 'hint' });
    const draw = () => {
      const missing = store.missingAssets();
      list.replaceChildren(...missing.map((a) => h('li', {}, a.name)));
      note.textContent = missing.length ? 'Pick the files from wherever they are now; they are matched by file name. You can also drop them on the window.' : 'All the media is back.';
      return missing.length;
    };
    draw();
    const pick = h('button', { class: 'btn btn-accent' }, 'Choose files…');
    const dlg = dialog('Find the media', h('div', { class: 'stack' }, h('p', {}, 'A project file holds the edit, not the video. These files are needed:'), list, note), [pick, h('button', { class: 'btn btn-ghost', onclick: () => dlg.close() }, 'Later')]);
    pick.addEventListener('click', async () => {
      const files = await pickFiles('video/*,audio/*,.mkv,.webm,.mov', true);
      if (!files.length) return;
      const n = await this.relinkMedia(files);
      store.say(n ? `Found ${n} file${n === 1 ? '' : 's'}.` : 'None of those files match. They are matched by file name.');
      if (draw() === 0) dlg.close();
    });
  }

  /** Files dropped on the window: a project opens, media that a loaded project is missing goes back, the rest is imported. */
  async dropFiles(files: File[]): Promise<void> {
    const project = files.find((f) => /\.turbocut$/i.test(f.name));
    if (project) return this.openProject(project);
    const missing = this.store.missingAssets();
    const matched = new Set(missing.length ? [...matchMedia(missing, files).values()] : []);
    if (matched.size) {
      await this.relinkMedia(files);
      this.store.say(`Found ${matched.size} file${matched.size === 1 ? '' : 's'} for the project.`);
    }
    const rest = files.filter((_, i) => !matched.has(i));
    if (rest.length) await this.importMedia(rest);
  }

  /**
   * Put a bin item on the timeline. Video goes to the active video track and its sound to the active audio track
   * (linked, so they split and delete together). It starts at `at` (default the playhead), moved later if that spot
   * is taken on either track. Dropping onto a specific track sends the matching part there. `only` puts just the picture
   * or just the sound (not linked to anything).
   */
  addAsset(assetId: string, opts: { at?: number; trackId?: string; only?: 'video' | 'audio' } = {}): boolean {
    const { store } = this;
    const asset = store.project.assets[assetId];
    if (!asset) return false;
    const dropped = opts.trackId ? store.project.tracks.find((t) => t.id === opts.trackId) : undefined;
    const pick = (kind: Track['kind']): Track => (dropped && dropped.kind === kind ? dropped : store.targetTrack(kind));
    const v = asset.hasVideo && opts.only !== 'audio' ? pick('video') : undefined;
    const a = asset.hasAudio && opts.only !== 'video' ? pick('audio') : undefined;
    if (!v && !a) {
      store.say(opts.only === 'audio' ? 'That file has no sound.' : 'That file has no picture.');
      return false;
    }
    if ((v && v.locked) || (a && a.locked)) {
      store.say('That track is locked.');
      return false;
    }
    const targets = [v, a].filter((t): t is Track => !!t);
    const start = findFreeStart(targets, opts.at ?? store.playhead, asset.duration);
    const link = v && a ? newId('l') : undefined;
    // Not selected afterwards: selecting a clip switches the side panel to the Clip tab, and someone adding several
    // clips from the bin should stay in the bin.
    store.edit((p) => {
      for (const t of targets) addClip(p, t.id, { ...createClip(assetId, start, asset.duration), link });
    });
    return true;
  }

  // ---------------------------------------------------------------- bin folders

  /** A new, empty folder in the media bin. Returns its id. */
  addFolder(name = 'New folder'): string {
    const id = newId('f');
    const base = name.trim() || 'New folder';
    const taken = new Set((this.store.project.folders ?? []).map((f) => f.name));
    let unique = base;
    for (let i = 2; taken.has(unique); i++) unique = `${base} ${i}`;
    this.store.edit((p) => (p.folders = [...(p.folders ?? []), { id, name: unique }]));
    return id;
  }

  renameFolder(id: string, name: string): void {
    const clean = name.trim();
    if (!clean) return;
    this.store.edit((p) => {
      const f = p.folders?.find((x) => x.id === id);
      if (f) f.name = clean;
    });
  }

  /** Delete a folder; what was inside goes back to the top level of the bin. */
  removeFolder(id: string): void {
    this.store.edit((p) => {
      p.folders = (p.folders ?? []).filter((f) => f.id !== id);
      for (const a of Object.values(p.assets)) if (a.folder === id) delete a.folder;
    });
  }

  /** Move a bin item into a folder (null: back to the top level). */
  moveToFolder(assetId: string, folder: string | null): void {
    this.store.edit((p) => {
      const a = p.assets[assetId];
      if (!a) return;
      if (folder && p.folders?.some((f) => f.id === folder)) a.folder = folder;
      else delete a.folder;
    });
  }

  /** Add a text layer at the playhead on the top video track (a new track above if that spot is taken). */
  addText(content = 'Your text'): void {
    const { store } = this;
    const p = store.project;
    const dur = p.fps * 3;
    const start = store.playhead;
    const videos = p.tracks.filter((t) => t.kind === 'video');
    const top = videos[videos.length - 1]!;
    const s = store.settings;
    const clip = createClip('', start, dur);
    clip.text = {
      content,
      style: {
        name: 'Text', fontname: s.defaultFont, fontsize: 110, primary: { r: 255, g: 255, b: 255, a: 255 }, outlineColour: { r: 0, g: 0, b: 0, a: 255 },
        backColour: { r: 0, g: 0, b: 0, a: 0 }, bold: true, italic: false, outline: 8, shadow: 0, alignment: 5, marginL: 60, marginR: 60, marginV: 0, counters: s.counters,
      },
      animation: { type: 'bounce', frames: 6, overshoot: 1.15 },
    };
    store.edit((pr) => {
      const target = top.locked || overlaps(top, start, dur) ? addTrack(pr, 'video') : pr.tracks.find((t) => t.id === top.id)!;
      addClip(pr, target.id, clip);
    });
    store.select(clip.id);
  }

  addTrack(kind: Track['kind']): void {
    let id = '';
    this.store.edit((p) => (id = addTrack(p, kind).id));
    this.store.setActiveTrack(id);
  }

  removeTrack(trackId: string): void {
    let ok = false;
    this.store.edit((p) => (ok = removeTrack(p, trackId)));
    if (!ok) this.store.say('Only an empty track can be deleted, and the last video and audio tracks stay.');
  }

  toggleTrack(trackId: string, what: 'hidden' | 'muted' | 'locked'): void {
    this.store.edit((p) => {
      const t = p.tracks.find((x) => x.id === trackId);
      if (t) t[what] = !t[what];
    });
  }

  /**
   * Split at the playhead, but only what you have chosen: the selected clip (with its linked picture or sound), the
   * selected caption, or, with nothing selected, whatever is at the playhead on the active track (the one you last
   * clicked, or the CC row). Only when no track has been chosen at all does it cut every track, like a first-time user expects.
   */
  split(): void {
    const { store } = this;
    const p = store.project;
    const f = store.playhead;
    const cuts: string[] = [];
    let cue: string | undefined;
    let where = 'the playhead';
    if (store.selectedCue) {
      const c = findCue(p, store.selectedCue);
      if (c && f > c.start && f < c.end) cue = c.id;
      where = 'the selected caption';
    } else if (store.selected) {
      const hit = findClip(p, store.selected);
      if (hit?.track.locked) return store.say('That track is locked.');
      if (hit && f > hit.clip.start && f < clipEnd(hit.clip)) cuts.push(hit.clip.id);
      where = 'the selected clip';
    } else if (store.activeTrack === CAPTION_TRACK) {
      const c = cueAt(p, f);
      if (c && f > c.start) cue = c.id;
      where = 'the caption row';
    } else {
      const only = p.tracks.find((t) => t.id === store.activeTrack);
      if (only?.locked) return store.say('That track is locked.');
      for (const t of only ? [only] : p.tracks) if (!t.locked) for (const c of t.clips) if (f > c.start && f < clipEnd(c)) cuts.push(c.id);
      if (only) where = `track ${only.name}`;
    }
    if (!cue && cuts.length === 0) return store.say(`Nothing to split at the playhead on ${where}.`);
    let done = true;
    store.edit(() => {
      if (cue) done = !!splitCue(p, cue, f);
      for (const id of cuts) splitLinked(p, id, f); // a linked partner is already split by its pair: the second call finds nothing to cut
    });
    if (!done) store.say('A caption of one word cannot be split.');
  }

  remove(ripple: boolean): void {
    const { store } = this;
    if (store.selectedCue) {
      const id = store.selectedCue;
      store.selectedCue = null;
      store.edit((p) => (p.captions = p.captions.filter((c) => c.id !== id)));
      return;
    }
    if (!store.selected) return;
    const id = store.selected;
    if (findClip(store.project, id)?.track.locked) return store.say('That track is locked.');
    store.select(null);
    store.edit((p) => removeLinked(p, id, ripple));
  }

  trimToPlayhead(side: 'start' | 'end'): void {
    const { store } = this;
    if (!store.selected) return;
    const id = store.selected;
    store.edit((p) => {
      const all = p.tracks.flatMap((t) => t.clips);
      const link = all.find((x) => x.id === id)?.link;
      for (const c of all.filter((c) => c.id === id || (link && c.link === link))) (side === 'start' ? trimStart : trimEnd)(p, c.id, store.playhead);
    });
  }

  toggleMute(): void {
    const { store } = this;
    if (!store.selected) return;
    store.edit((p) => {
      for (const t of p.tracks) for (const c of t.clips) if (c.id === store.selected) c.muted = !c.muted;
    });
  }

  toggleSnapping(): void {
    this.store.updateSettings((s) => (s.snapping = !s.snapping));
    this.store.say(this.store.settings.snapping ? 'Snapping on.' : 'Snapping off.');
  }

  step(frames: number): void {
    this.store.seek(this.store.playhead + frames);
  }

  async runExport(): Promise<void> {
    const { store, player } = this;
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
}

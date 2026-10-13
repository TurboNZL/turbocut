import { addClip, addTrack, clipEnd, createClip, findClip, findFreeStart, newId, projectDuration, removeLinked, removeTrack, splitLinked, trimEnd, trimStart } from '../core/timeline.ts';
import type { Track } from '../core/types.ts';
import { exportProject } from '../export/exporter.ts';
import { dialog, h } from './dom.ts';
import { keepAwake, saveFile } from './platform.ts';
import type { Player } from './player.ts';
import type { Store } from './store.ts';

/** Everything the person can do to the project, as plain functions the buttons, shortcuts and tests all call. */
export class Actions {
  constructor(private store: Store, private player: Player) {}

  /**
   * Open files into the media bin. The very first import into an empty timeline is also placed on it, so a
   * single clip is one step; after that, files wait in the bin until they are added.
   */
  async importMedia(files: File[], place?: boolean): Promise<void> {
    const { store } = this;
    for (const file of files) {
      try {
        store.say(`Importing ${file.name}…`);
        const asset = await store.lib.importFile(file, file.name, store.project.fps);
        const empty = store.project.tracks.every((t) => t.clips.length === 0);
        store.edit((p) => (p.assets[asset.id] = asset));
        if (place ?? empty) this.addAsset(asset.id);
        store.say(place ?? empty ? `Imported ${file.name}.` : `${file.name} is in the media bin. Open Media and tap Add.`);
      } catch (e) {
        store.say(`Could not open ${file.name}: ${e instanceof Error ? e.message : e}. This device may not support its format.`);
      }
    }
  }

  /**
   * Put a bin item on the timeline. Video goes to the active video track and its sound to the active audio track
   * (linked, so they split and delete together). It starts at `at` (default the playhead), moved later if that spot
   * is taken on either track. Dropping onto a specific track sends the matching part there.
   */
  addAsset(assetId: string, opts: { at?: number; trackId?: string } = {}): boolean {
    const { store } = this;
    const asset = store.project.assets[assetId];
    if (!asset) return false;
    const dropped = opts.trackId ? store.project.tracks.find((t) => t.id === opts.trackId) : undefined;
    const pick = (kind: Track['kind']): Track => (dropped && dropped.kind === kind ? dropped : store.targetTrack(kind));
    const v = asset.hasVideo ? pick('video') : undefined;
    const a = asset.hasAudio ? pick('audio') : undefined;
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

  split(): void {
    const { store } = this;
    const p = store.project;
    const f = store.playhead;
    store.edit(() => {
      if (store.selected) {
        if (!findClip(p, store.selected)?.track.locked) splitLinked(p, store.selected, f);
      } else for (const t of p.tracks) if (!t.locked) for (const c of [...t.clips]) if (f > c.start && f < clipEnd(c)) splitLinked(p, c.id, f);
    });
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

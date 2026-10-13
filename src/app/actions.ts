import { addClip, clipEnd, createClip, newId, projectDuration, removeLinked, splitLinked, trimEnd, trimStart } from '../core/timeline.ts';
import { exportProject } from '../export/exporter.ts';
import { dialog, h } from './dom.ts';
import { keepAwake, saveFile } from './platform.ts';
import type { Player } from './player.ts';
import type { Store } from './store.ts';

/** Everything the person can do to the project, as plain functions the buttons, shortcuts and tests all call. */
export class Actions {
  constructor(private store: Store, private player: Player) {}

  async importMedia(files: File[]): Promise<void> {
    const { store } = this;
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

  split(): void {
    const { store } = this;
    const p = store.project;
    const f = store.playhead;
    store.edit(() => {
      if (store.selected) splitLinked(p, store.selected, f);
      else for (const t of p.tracks) if (!t.locked) for (const c of [...t.clips]) if (f > c.start && f < clipEnd(c)) splitLinked(p, c.id, f);
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

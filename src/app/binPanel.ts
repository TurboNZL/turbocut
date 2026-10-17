import type { Asset } from '../core/types.ts';
import type { Actions } from './actions.ts';
import { askText, fmtTime, h, popupMenu } from './dom.ts';
import { icon } from './icons.ts';
import type { Store } from './store.ts';
import type { TimelineView } from './timelineView.ts';

/**
 * The media bin: everything that has been imported, with a thumbnail, in folders if the person made some. Press Add to
 * put an item on the timeline at the playhead, or (with a mouse) drag it onto a track: the thumbnail drags picture and
 * sound together, the two small grips drag only the picture or only the sound. Drag onto a folder to file it.
 */
export class BinPanel {
  readonly el = h('div', { class: 'bin' });
  /** Folders the person has closed (open is the default, so a new folder shows what is in it). */
  private closed = new Set<string>();

  constructor(private store: Store, private actions: Actions, private timeline: TimelineView, private importFiles: (folder?: string) => void, private importTwitch?: () => void) {
    store.on('project', () => this.render());
    this.render();
  }

  /** How many times the asset is on the timeline. A video clip and its linked sound are one placement. */
  private usedBy(assetId: string): number {
    const placements = new Set<string>();
    for (const t of this.store.project.tracks) for (const c of t.clips) if (c.assetId === assetId) placements.add(c.link ?? c.id);
    return placements.size;
  }

  private grip(asset: Asset, only: 'video' | 'audio'): HTMLElement {
    const g = h('button', { class: 'btn btn-ghost bin-grip', 'aria-label': `Drag ${asset.name}: ${only === 'video' ? 'picture only' : 'sound only'}`, title: only === 'video' ? 'Drag the picture only' : 'Drag the sound only' }, icon(only, 16));
    g.addEventListener('pointerdown', (e) => this.startDrag(e, asset, only));
    return g;
  }

  private item(asset: Asset): HTMLElement {
    const { store } = this;
    const fps = store.project.fps;
    const thumb = h('div', { class: 'bin-thumb', title: 'Drag onto a track' }, asset.hasVideo ? null : icon('audio', 22));
    if (asset.hasVideo) void store.lib.thumbnail(asset.id).then((c) => c && thumb.append(c));
    const uses = this.usedBy(asset.id);
    const meta = `${fmtTime(asset.duration, fps).replace(/\.\d+$/, '')}${asset.hasVideo ? ` · ${asset.width}×${asset.height}` : ' · audio'}${uses ? ` · used ${uses}×` : ''}`;
    const add = h('button', { class: 'btn btn-accent', onclick: () => this.actions.addAsset(asset.id) }, 'Add');
    const remove = h('button', {
      class: 'btn btn-ghost',
      disabled: uses > 0,
      title: uses ? 'Remove its clips from the timeline first' : 'Remove from the bin',
      onclick: () => store.edit((p) => delete p.assets[asset.id]),
    }, 'Remove');
    const more = h('button', { class: 'btn btn-ghost', 'aria-label': `Move ${asset.name} to a folder`, title: 'Move to a folder' }, icon('folder', 16));
    more.addEventListener('click', () => {
      const folders = store.project.folders ?? [];
      popupMenu(more, [
        ...folders.filter((f) => f.id !== asset.folder).map((f) => ({ label: `Move to ${f.name}`, run: () => this.actions.moveToFolder(asset.id, f.id) })),
        ...(asset.folder ? [{ label: 'Move out of the folder', run: () => this.actions.moveToFolder(asset.id, null) }] : []),
        { label: 'Move to a new folder…', run: () => void this.newFolder().then((id) => id && this.actions.moveToFolder(asset.id, id)) },
      ]);
    });
    thumb.addEventListener('pointerdown', (e) => this.startDrag(e, asset));
    const grips = asset.hasVideo && asset.hasAudio ? h('span', { class: 'bin-grips' }, this.grip(asset, 'video'), this.grip(asset, 'audio')) : null;
    return h('div', { class: 'bin-item', 'data-asset': asset.id }, thumb, h('div', {}, h('div', { class: 'bin-name', title: asset.name }, asset.name), h('div', { class: 'bin-meta' }, meta), h('div', { class: 'bin-actions' }, add, grips, more, remove)));
  }

  private async newFolder(): Promise<string | null> {
    const name = await askText('New folder', 'New folder', 'Folder name', 'Create');
    return name ? this.actions.addFolder(name) : null;
  }

  /** Mouse drag from the bin onto a track (or a folder). (A finger on the thumbnail scrolls the list instead; touch uses Add.) */
  private startDrag(e: PointerEvent, asset: Asset, only?: 'video' | 'audio'): void {
    if (e.pointerType === 'touch') return;
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    let ghost: HTMLElement | null = null;
    let over: HTMLElement | null = null;
    const at = (x: number, y: number) => {
      const stack = document.elementsFromPoint(x, y) as HTMLElement[];
      return stack.find((n) => n.dataset?.track && n.dataset.track !== 'captions') ?? stack.find((n) => n.dataset?.dropFolder !== undefined);
    };
    const move = (ev: PointerEvent) => {
      if (!ghost && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
      ghost ??= document.body.appendChild(h('div', { class: 'drag-ghost' }, `${only === 'video' ? 'Picture of ' : only === 'audio' ? 'Sound of ' : ''}${asset.name}`));
      ghost.style.left = `${ev.clientX + 12}px`;
      ghost.style.top = `${ev.clientY + 12}px`;
      const t = at(ev.clientX, ev.clientY) ?? null;
      if (t !== over) {
        over?.classList.remove('drop-target');
        over = t;
        over?.classList.add('drop-target');
      }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ghost?.remove();
      over?.classList.remove('drop-target');
      if (!ghost) return;
      const t = at(ev.clientX, ev.clientY);
      if (!t) return;
      if (t.dataset.track) this.actions.addAsset(asset.id, { at: this.timeline.frameAtClientX(ev.clientX), trackId: t.dataset.track, only });
      else if (t.dataset.dropFolder !== undefined) this.actions.moveToFolder(asset.id, t.dataset.dropFolder || null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private folderBlock(f: { id: string; name: string }, items: Asset[]): HTMLElement {
    const open = !this.closed.has(f.id);
    const more = h('button', { class: 'btn btn-ghost', 'aria-label': `Folder ${f.name} options`, title: 'Folder options' }, icon('more', 16));
    more.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      popupMenu(more, [
        { label: 'Import into this folder…', run: () => this.importFiles(f.id) },
        { label: 'Rename…', run: () => void askText('Rename folder', f.name, 'Folder name', 'Rename').then((n) => n && this.actions.renameFolder(f.id, n)) },
        { label: 'Delete folder (keeps its items)', run: () => this.actions.removeFolder(f.id) },
      ]);
    });
    const summary = h('summary', { class: 'bin-folder-head' }, icon('chevron', 14), icon('folder', 16), h('span', { class: 'bin-folder-name' }, f.name), h('span', { class: 'hint' }, `${items.length}`), more);
    const body = h('div', { class: 'bin-folder-body' }, ...(items.length ? items.map((a) => this.item(a)) : [h('p', { class: 'hint' }, 'Empty. Drag a clip here, or use Move to a folder.')]));
    const det = h('details', { class: 'bin-folder', 'data-drop-folder': f.id, open }, summary, body);
    det.addEventListener('toggle', () => (det.open ? this.closed.delete(f.id) : this.closed.add(f.id)));
    return det;
  }

  private render(): void {
    const { project: p } = this.store;
    const assets = Object.values(p.assets);
    const folders = p.folders ?? [];
    const loose = assets.filter((a) => !a.folder || !folders.some((f) => f.id === a.folder));
    const newFolder = h('button', { class: 'btn', onclick: () => void this.newFolder() }, icon('folderPlus', 16), h('span', {}, 'New folder'));
    const hint = assets.length
      ? 'Press Add to put a clip on the timeline at the playhead. With a mouse, drag a thumbnail onto a track (the small grips drag only the picture or only the sound) or onto a folder.'
      : 'Nothing here yet. Import video or audio files and they wait in this bin until you add them to the timeline.';
    this.el.replaceChildren(
      h('div', { class: 'row' }, h('button', { class: 'btn btn-accent', onclick: () => this.importFiles() }, 'Import files…'), ...(this.importTwitch ? [h('button', { class: 'btn', onclick: () => this.importTwitch!() }, 'Twitch clip…')] : []), newFolder),
      h('p', { class: 'hint' }, hint),
      ...folders.map((f) => this.folderBlock(f, assets.filter((a) => a.folder === f.id))),
      ...(folders.length && loose.length ? [h('div', { class: 'bin-root', 'data-drop-folder': '' }, h('h3', { class: 'bin-root-title' }, 'Not in a folder'), ...loose.map((a) => this.item(a)))] : loose.map((a) => this.item(a))),
    );
  }
}

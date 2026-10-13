import type { Asset } from '../core/types.ts';
import type { Actions } from './actions.ts';
import { fmtTime, h } from './dom.ts';
import type { Store } from './store.ts';
import type { TimelineView } from './timelineView.ts';

/**
 * The media bin: everything that has been imported, with a thumbnail. Tap Add to put an item on the timeline at the
 * playhead, or (with a mouse) drag it onto a track to drop it exactly where you want it.
 */
export class BinPanel {
  readonly el = h('div', { class: 'bin' });

  constructor(private store: Store, private actions: Actions, private timeline: TimelineView, private importFiles: () => void) {
    store.on('project', () => this.render());
    this.render();
  }

  /** How many times the asset is on the timeline. A video clip and its linked sound are one placement. */
  private usedBy(assetId: string): number {
    const placements = new Set<string>();
    for (const t of this.store.project.tracks) for (const c of t.clips) if (c.assetId === assetId) placements.add(c.link ?? c.id);
    return placements.size;
  }

  private item(asset: Asset): HTMLElement {
    const { store } = this;
    const fps = store.project.fps;
    const thumb = h('div', { class: 'bin-thumb', title: 'Drag onto a track' }, asset.hasVideo ? null : h('span', { class: 'hint' }, '♪'));
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
    thumb.addEventListener('pointerdown', (e) => this.startDrag(e, asset));
    return h('div', { class: 'bin-item', 'data-asset': asset.id }, thumb, h('div', {}, h('div', { class: 'bin-name', title: asset.name }, asset.name), h('div', { class: 'bin-meta' }, meta), h('div', { class: 'bin-actions' }, add, remove)));
  }

  /** Mouse drag from the bin onto a track. (A finger on the thumbnail scrolls the list instead; touch uses Add.) */
  private startDrag(e: PointerEvent, asset: Asset): void {
    if (e.pointerType === 'touch') return;
    const startX = e.clientX;
    const startY = e.clientY;
    let ghost: HTMLElement | null = null;
    let over: HTMLElement | null = null;
    const trackAt = (x: number, y: number) => document.elementsFromPoint(x, y).find((n) => (n as HTMLElement).dataset?.track) as HTMLElement | undefined;
    const move = (ev: PointerEvent) => {
      if (!ghost && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
      ghost ??= document.body.appendChild(h('div', { class: 'drag-ghost' }, asset.name));
      ghost.style.left = `${ev.clientX + 12}px`;
      ghost.style.top = `${ev.clientY + 12}px`;
      const t = trackAt(ev.clientX, ev.clientY) ?? null;
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
      const t = trackAt(ev.clientX, ev.clientY);
      if (t?.dataset.track) this.actions.addAsset(asset.id, { at: this.timeline.frameAtClientX(ev.clientX), trackId: t.dataset.track });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private render(): void {
    const assets = Object.values(this.store.project.assets);
    this.el.replaceChildren(
      h('div', { class: 'row' }, h('button', { class: 'btn btn-accent', onclick: () => this.importFiles() }, 'Import files…')),
      assets.length ? h('p', { class: 'hint' }, 'Tap Add to put a clip on the timeline at the playhead. With a mouse you can also drag a thumbnail onto a track.') : h('p', { class: 'hint' }, 'Nothing here yet. Import video or audio files and they wait in this bin until you add them.'),
      ...assets.map((a) => this.item(a)),
    );
  }
}

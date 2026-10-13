import { clipEnd, moveLinked, trimEnd, trimStart } from '../core/timeline.ts';
import type { Clip, Track } from '../core/types.ts';
import { fmtTime, h } from './dom.ts';
import type { Store } from './store.ts';

const HEAD_W = 56;
const EDGE = 9; // px grab zone on each end of a clip

/** Time ruler, tracks, clips and playhead. Dragging moves/trims clips with snapping; clicking the ruler scrubs. */
export class TimelineView {
  readonly el = h('div', { class: 'tl' });
  private scroller = h('div', { class: 'tl-scroll' });
  private content = h('div', { class: 'tl-content' });
  private playhead = h('div', { class: 'tl-playhead' });

  constructor(private store: Store) {
    this.scroller.append(this.content);
    this.el.append(this.scroller);
    store.on('project', () => this.render());
    store.on('selection', () => this.render());
    store.on('view', () => this.render());
    store.on('preset', () => this.render());
    store.on('playhead', () => this.movePlayhead());
    this.render();
  }

  private px(frame: number): number {
    return frame * this.store.zoom;
  }

  private snapPoints(except: Clip | null): number[] {
    const pts = [0, this.store.playhead];
    for (const t of this.store.project.tracks) for (const c of t.clips) if (c !== except) pts.push(c.start, clipEnd(c));
    return pts;
  }

  private snap(frame: number, points: number[]): number {
    const tol = 8 / this.store.zoom;
    let best = frame;
    let d = tol;
    for (const p of points) if (Math.abs(p - frame) < d) ((d = Math.abs(p - frame)), (best = p));
    return best;
  }

  render(): void {
    const { project: p, zoom } = this.store;
    const end = Math.max(p.fps * 20, ...p.tracks.flatMap((t) => t.clips.map(clipEnd)), ...p.captions.map((c) => c.end)) + p.fps * 10;
    const width = end * zoom;
    const content = h('div', { class: 'tl-content', style: { width: `${width + HEAD_W}px` } });

    // ruler
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * p.fps * zoom >= 70) ?? 600; // seconds between labels
    const ruler = h('div', { class: 'tl-ruler', style: { paddingLeft: `${HEAD_W}px` } });
    for (let s = 0; s * p.fps < end; s += step) ruler.append(h('span', { class: 'tl-tick', style: { left: `${HEAD_W + s * p.fps * zoom}px` } }, fmtTime(s * p.fps, p.fps).replace(/\.\d+$/, '')));
    ruler.addEventListener('pointerdown', (e) => this.scrub(e, ruler));
    content.append(ruler);

    // tracks, top of the screen = last track (like most editors, higher layers above)
    for (const track of [...p.tracks].reverse()) content.append(this.trackRow(track));
    content.append(this.captionRow());

    content.append(this.playhead);
    this.content.replaceWith(content);
    this.content = content;
    this.movePlayhead();
  }

  private trackRow(track: Track): HTMLElement {
    const { selected } = this.store;
    const row = h(
      'div',
      { class: `tl-track tl-${track.kind}`, 'data-track': track.id },
      h('div', { class: 'tl-head' }, track.name),
    );
    for (const clip of track.clips) {
      const asset = this.store.project.assets[clip.assetId];
      const el = h(
        'div',
        { class: `tl-clip${clip.id === selected ? ' sel' : ''}${clip.muted ? ' muted' : ''}`, style: { left: `${HEAD_W + this.px(clip.start)}px`, width: `${Math.max(2, this.px(clip.duration))}px` }, title: asset?.name },
        h('span', { class: 'tl-name' }, asset?.name ?? ''),
        clip.effects.length ? h('span', { class: 'tl-fx' }, 'fx') : null,
        Object.values(clip.keys).some((k) => k?.length) ? h('span', { class: 'tl-fx' }, '◆') : null,
      );
      el.addEventListener('pointerdown', (e) => this.clipDrag(e, clip, track));
      row.append(el);
    }
    row.addEventListener('pointerdown', (e) => {
      if (e.target !== row && !(e.target as HTMLElement).classList.contains('tl-head')) return;
      this.store.select(null);
      this.scrub(e, row);
    });
    return row;
  }

  private captionRow(): HTMLElement {
    const { project: p } = this.store;
    const row = h('div', { class: 'tl-track tl-caption' }, h('div', { class: 'tl-head' }, 'CC'));
    for (const cue of p.captions) {
      const el = h('div', { class: `tl-clip tl-cue${cue.id === this.store.selectedCue ? ' sel' : ''}`, style: { left: `${HEAD_W + this.px(cue.start)}px`, width: `${Math.max(2, this.px(cue.end - cue.start))}px` }, title: cue.text }, h('span', { class: 'tl-name' }, cue.text));
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.store.selectedCue = cue.id;
        this.store.seek(cue.start);
        this.store.emit('selection');
      });
      row.append(el);
    }
    row.addEventListener('pointerdown', (e) => e.target === row && this.scrub(e, row));
    return row;
  }

  /** Click or drag on the ruler/empty track area to move the playhead. */
  private scrub(e: PointerEvent, ref: HTMLElement): void {
    if (this.store.playing) return;
    const frameAt = (ev: PointerEvent) => {
      const x = ev.clientX - this.content.getBoundingClientRect().left - HEAD_W;
      return Math.max(0, Math.round(x / this.store.zoom));
    };
    this.store.seek(frameAt(e));
    const move = (ev: PointerEvent) => this.store.seek(frameAt(ev));
    const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up));
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    void ref;
  }

  private clipDrag(e: PointerEvent, clip: Clip, track: Track): void {
    e.stopPropagation();
    e.preventDefault();
    const store = this.store;
    store.select(clip.id);
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const mode: 'move' | 'left' | 'right' = e.clientX - rect.left < EDGE ? 'left' : rect.right - e.clientX < EDGE ? 'right' : 'move';
    const startX = e.clientX;
    const origStart = clip.start;
    const origEnd = clipEnd(clip);
    const points = this.snapPoints(clip);
    let began = false;

    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - startX) / store.zoom);
      if (!began && Math.abs(ev.clientX - startX) < 3 && ev.clientY === e.clientY) return;
      if (!began) ((began = true), store.begin());
      const cur = store.project.tracks.flatMap((t) => t.clips).find((c) => c.id === clip.id);
      if (!cur) return;
      if (mode === 'move') {
        let start = origStart + dx;
        const s1 = this.snap(start, points);
        const s2 = this.snap(start + cur.duration, points) - cur.duration;
        start = Math.abs(s1 - start) <= Math.abs(s2 - start) ? s1 : s2;
        // Which track is the pointer over? Only same-kind tracks accept the clip.
        const under = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => (n as HTMLElement).dataset?.track) as HTMLElement | undefined;
        const toTrack = under?.dataset.track && store.project.tracks.find((t) => t.id === under.dataset.track && t.kind === track.kind) ? under.dataset.track : undefined;
        moveLinked(store.project, cur.id, Math.max(0, start), toTrack);
      } else if (mode === 'left') trimStart(store.project, cur.id, this.snap(origStart + dx, points));
      else trimEnd(store.project, cur.id, this.snap(origEnd + dx, points));
      store.emit('project');
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private movePlayhead(): void {
    const x = HEAD_W + this.px(this.store.playhead);
    this.playhead.style.transform = `translateX(${x}px)`;
    // keep the playhead visible while playing or stepping
    const s = this.scroller;
    const view = s.clientWidth;
    if (x < s.scrollLeft + HEAD_W || x > s.scrollLeft + view - 20) s.scrollLeft = Math.max(0, x - view / 3);
  }
}

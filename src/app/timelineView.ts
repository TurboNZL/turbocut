import { clipEnd, moveLinked, trimEnd, trimStart } from '../core/timeline.ts';
import type { Clip, Track } from '../core/types.ts';
import { fmtTime, h } from './dom.ts';
import type { Store } from './store.ts';

const HEAD_W = 56; // track label column on desktop
const EDGE = 9; // grab zone on each end of a clip with a mouse

export interface TimelineOptions {
  /** Called when a finger touches the timeline, so playback can stop before the user scrubs. */
  onUserTouch?: () => void;
}

/**
 * Ruler, tracks, clips, playhead.
 *
 * Mouse: the playhead moves; drag clips and their edges, click the ruler to scrub.
 * Touch: the playhead stays in the middle and the timeline scrolls under it, so panning IS scrubbing and
 * momentum scrolling works. Tapping selects a clip; only the selected clip can be dragged, and it gets
 * big handles on both ends. Unselected clips never capture a finger, so they cannot get in the way of panning.
 */
export class TimelineView {
  readonly el = h('div', { class: 'tl' });
  private scroller = h('div', { class: 'tl-scroll' });
  private content = h('div', { class: 'tl-content' });
  private playhead = h('div', { class: 'tl-playhead' });
  private tip = h('div', { class: 'tl-tip' });
  readonly touch = matchMedia('(pointer: coarse)').matches;

  /** x offset of frame 0 inside the content: the label column on desktop, half the view on touch. */
  private pad = HEAD_W;
  private dragging = false;
  private fromScroll = false;
  private lastWritten = -1;

  constructor(private store: Store, private opts: TimelineOptions = {}) {
    this.el.classList.toggle('touch', this.touch);
    this.scroller.append(this.content);
    this.el.append(this.scroller, this.tip);
    if (this.touch) this.el.append(this.playhead);
    store.on('project', () => this.render());
    store.on('selection', () => this.render());
    store.on('view', () => this.render());
    store.on('preset', () => this.render());
    store.on('playhead', () => this.movePlayhead());
    this.scroller.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.scroller.addEventListener('pointerdown', () => this.opts.onUserTouch?.());
    new ResizeObserver(() => this.render()).observe(this.scroller);
    this.el.addEventListener('contextmenu', (e) => e.preventDefault()); // no long-press menu on clips
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
    const tol = (this.touch ? 14 : 8) / this.store.zoom;
    let best = frame;
    let d = tol;
    for (const p of points) if (Math.abs(p - frame) < d) ((d = Math.abs(p - frame)), (best = p));
    return best;
  }

  render(): void {
    const { project: p, zoom } = this.store;
    const view = this.scroller.clientWidth;
    this.pad = this.touch ? Math.round(view / 2) : HEAD_W;
    const end = Math.max(p.fps * 20, ...p.tracks.flatMap((t) => t.clips.map(clipEnd)), ...p.captions.map((c) => c.end)) + (this.touch ? 0 : p.fps * 10);
    const width = this.pad + end * zoom + (this.touch ? this.pad : 0);
    const content = h('div', { class: 'tl-content', style: { width: `${width}px` } });

    // ruler
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * p.fps * zoom >= 70) ?? 600; // seconds between labels
    const ruler = h('div', { class: 'tl-ruler' });
    for (let s = 0; s * p.fps < end; s += step) ruler.append(h('span', { class: 'tl-tick', style: { left: `${this.pad + s * p.fps * zoom}px` } }, fmtTime(s * p.fps, p.fps).replace(/\.\d+$/, '')));
    if (!this.touch) ruler.addEventListener('pointerdown', (e) => this.scrub(e));
    content.append(ruler);

    // tracks, top of the screen = last track (higher layers above)
    for (const track of [...p.tracks].reverse()) content.append(this.trackRow(track));
    content.append(this.captionRow());
    if (!this.touch) content.append(this.playhead);

    this.content.replaceWith(content);
    this.content = content;
    this.movePlayhead(true);
  }

  private trackRow(track: Track): HTMLElement {
    const { selected } = this.store;
    const row = h('div', { class: `tl-track tl-${track.kind}`, 'data-track': track.id }, h('div', { class: 'tl-head' }, track.name));
    let selectedClip: Clip | null = null;
    for (const clip of track.clips) {
      const asset = this.store.project.assets[clip.assetId];
      const isSel = clip.id === selected;
      if (isSel) selectedClip = clip;
      const el = h(
        'div',
        { class: `tl-clip${isSel ? ' sel' : ''}${clip.muted ? ' muted' : ''}`, style: { left: `${this.pad + this.px(clip.start)}px`, width: `${Math.max(2, this.px(clip.duration))}px` }, title: asset?.name },
        h('span', { class: 'tl-name' }, asset?.name ?? ''),
        clip.effects.length ? h('span', { class: 'tl-fx' }, 'fx') : null,
        Object.values(clip.keys).some((k) => k?.length) ? h('span', { class: 'tl-fx' }, '◆') : null,
      );
      if (this.touch) {
        // Unselected clips only react to a tap, so a finger dragged across them pans the timeline natively.
        el.addEventListener('click', () => this.store.select(clip.id));
        if (isSel) el.addEventListener('pointerdown', (e) => this.clipDrag(e, clip, track, 'move'));
      } else el.addEventListener('pointerdown', (e) => this.clipDrag(e, clip, track));
      row.append(el);
    }
    if (this.touch && selectedClip) {
      for (const side of ['left', 'right'] as const) {
        const x = this.pad + this.px(side === 'left' ? selectedClip.start : clipEnd(selectedClip));
        const handle = h('div', { class: `tl-handle ${side}`, style: { left: `${x - 16}px` }, 'aria-label': side === 'left' ? 'Trim start' : 'Trim end' }, h('i'));
        const c = selectedClip;
        handle.addEventListener('pointerdown', (e) => this.clipDrag(e, c, track, side));
        row.append(handle);
      }
    }
    row.addEventListener('click', (e) => e.target === row && this.store.select(null));
    if (!this.touch) {
      row.addEventListener('pointerdown', (e) => {
        if (e.target !== row && !(e.target as HTMLElement).classList.contains('tl-head')) return;
        this.store.select(null);
        this.scrub(e);
      });
    }
    return row;
  }

  private captionRow(): HTMLElement {
    const { project: p } = this.store;
    const row = h('div', { class: 'tl-track tl-caption' }, h('div', { class: 'tl-head' }, 'CC'));
    for (const cue of p.captions) {
      const el = h('div', { class: `tl-clip tl-cue${cue.id === this.store.selectedCue ? ' sel' : ''}`, style: { left: `${this.pad + this.px(cue.start)}px`, width: `${Math.max(2, this.px(cue.end - cue.start))}px` }, title: cue.text }, h('span', { class: 'tl-name' }, cue.text));
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.store.selectedCue = cue.id;
        this.store.seek(cue.start);
        this.store.emit('selection');
      });
      row.append(el);
    }
    return row;
  }

  /** Mouse: click or drag on the ruler/empty track area to move the playhead. */
  private scrub(e: PointerEvent): void {
    if (this.store.playing) return;
    const frameAt = (ev: PointerEvent) => Math.max(0, Math.round((ev.clientX - this.content.getBoundingClientRect().left - this.pad) / this.store.zoom));
    this.store.seek(frameAt(e));
    const move = (ev: PointerEvent) => this.store.seek(frameAt(ev));
    const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up));
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private clipDrag(e: PointerEvent, clip: Clip, track: Track, forced?: 'move' | 'left' | 'right'): void {
    e.stopPropagation();
    e.preventDefault();
    const store = this.store;
    store.select(clip.id);
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const mode: 'move' | 'left' | 'right' = forced ?? (e.clientX - rect.left < EDGE ? 'left' : rect.right - e.clientX < EDGE ? 'right' : 'move');
    const startX = e.clientX;
    const startY = e.clientY;
    const origStart = clip.start;
    const origEnd = clipEnd(clip);
    const points = this.snapPoints(clip);
    const slop = this.touch ? 6 : 3;
    let began = false;

    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - startX) / store.zoom);
      if (!began && Math.abs(ev.clientX - startX) < slop && Math.abs(ev.clientY - startY) < slop) return;
      if (!began) {
        began = true;
        this.dragging = true;
        store.begin();
      }
      const cur = store.project.tracks.flatMap((t) => t.clips).find((c) => c.id === clip.id);
      if (!cur) return;
      let edgeFrame = cur.start;
      if (mode === 'move') {
        let start = origStart + dx;
        const s1 = this.snap(start, points);
        const s2 = this.snap(start + cur.duration, points) - cur.duration;
        start = Math.abs(s1 - start) <= Math.abs(s2 - start) ? s1 : s2;
        // Which track is the pointer over? Only same-kind tracks accept the clip.
        const under = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => (n as HTMLElement).dataset?.track) as HTMLElement | undefined;
        const toTrack = under?.dataset.track && store.project.tracks.find((t) => t.id === under.dataset.track && t.kind === track.kind) ? under.dataset.track : undefined;
        moveLinked(store.project, cur.id, Math.max(0, start), toTrack);
      } else if (mode === 'left') {
        trimStart(store.project, cur.id, this.snap(origStart + dx, points));
        edgeFrame = cur.start;
      } else {
        trimEnd(store.project, cur.id, this.snap(origEnd + dx, points));
        edgeFrame = clipEnd(cur) - 1;
      }
      if (mode !== 'move') {
        // The preview follows the edge being trimmed, so you see the exact frame you are cutting at.
        store.seek(edgeFrame);
        this.showTip(ev.clientX, ev.clientY, `${mode === 'left' ? 'In' : 'Out'} ${fmtTime(edgeFrame, store.project.fps)}  (${fmtTime(cur.duration, store.project.fps)} long)`);
      } else this.showTip(ev.clientX, ev.clientY, fmtTime(cur.start, store.project.fps));
      store.emit('project');
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.tip.style.display = 'none';
      if (this.dragging) {
        this.dragging = false;
        this.movePlayhead(true); // bring the edge you just trimmed back to the middle
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  private showTip(x: number, y: number, text: string): void {
    const r = this.el.getBoundingClientRect();
    this.tip.textContent = text;
    this.tip.style.display = 'block';
    this.tip.style.left = `${Math.min(Math.max(8, x - r.left - 60), r.width - 150)}px`;
    this.tip.style.top = `${Math.max(2, y - r.top - 64)}px`;
  }

  /** Touch: the person scrolled the timeline, so that is the new playhead position. */
  private onScroll(): void {
    if (!this.touch || this.dragging) return;
    // A scroll we wrote ourselves (following playback, or after a drag) must not seek again.
    if (Math.abs(this.scroller.scrollLeft - this.lastWritten) < 2) return;
    this.lastWritten = -1;
    if (this.store.playing) return;
    this.fromScroll = true;
    this.store.seek(Math.round(this.scroller.scrollLeft / this.store.zoom));
    this.fromScroll = false;
  }

  private movePlayhead(force = false): void {
    const s = this.scroller;
    if (this.touch) {
      // Frame f is under the fixed playhead when scrollLeft = f * zoom (because pad is half the view).
      if (this.fromScroll || (this.dragging && !force)) return;
      const target = Math.round(this.store.playhead * this.store.zoom);
      if (Math.abs(s.scrollLeft - target) > 0.5) {
        this.lastWritten = target;
        s.scrollLeft = target;
      }
      return;
    }
    const x = this.pad + this.px(this.store.playhead);
    this.playhead.style.transform = `translateX(${x}px)`;
    // keep the playhead visible while playing or stepping
    const view = s.clientWidth;
    if (x < s.scrollLeft + HEAD_W || x > s.scrollLeft + view - 20) s.scrollLeft = Math.max(0, x - view / 3);
  }
}

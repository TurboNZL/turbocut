import { clipEnd, moveLinked, trimEnd, trimStart } from '../core/timeline.ts';
import { drawWave } from '../media/waveform.ts';
import type { Clip, Track } from '../core/types.ts';
import { fmtTime, h, popupMenu } from './dom.ts';
import { icon, type IconName } from './icons.ts';
import { CAPTION_TRACK, type Store } from './store.ts';

const HEAD_W = 56; // track label column on desktop
const EDGE = 9; // grab zone on each end of a clip with a mouse

export interface TimelineOptions {
  /** Track menu choices: the app wires these to its actions. */
  trackActions?: {
    toggle(trackId: string, what: 'hidden' | 'muted' | 'locked'): void;
    remove(trackId: string): void;
    add(kind: Track['kind']): void;
  };
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
  private pinching = false;
  private lastWritten = -1;

  constructor(private store: Store, private opts: TimelineOptions = {}) {
    this.el.classList.toggle('touch', this.touch);
    this.scroller.append(this.content);
    this.el.append(this.scroller, this.tip);
    if (this.touch) this.el.append(this.playhead);
    store.on('project', () => this.render());
    store.on('selection', () => this.render());
    store.on('view', () => this.applyZoom());
    store.on('preset', () => this.render());
    store.on('settings', () => this.render());
    store.on('playhead', () => this.movePlayhead());
    this.scroller.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.scroller.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.setupPinch();
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
    if (!this.store.settings.snapping) return frame;
    const tol = (this.touch ? 14 : 8) / this.store.zoom;
    let best = frame;
    let d = tol;
    for (const p of points) if (Math.abs(p - frame) < d) ((d = Math.abs(p - frame)), (best = p));
    return best;
  }

  /** Frame at the far end of the timeline: past the last clip, with room to work. */
  private endFrame(): number {
    const { project: p } = this.store;
    return Math.max(p.fps * 20, ...p.tracks.flatMap((t) => t.clips.map(clipEnd)), ...p.captions.map((c) => c.end)) + (this.touch ? 0 : p.fps * 10);
  }

  private contentWidth(): number {
    return this.pad + this.endFrame() * this.store.zoom + (this.touch ? this.pad : 0);
  }

  private fillRuler(ruler: HTMLElement): void {
    const { project: p, zoom } = this.store;
    const end = this.endFrame();
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * p.fps * zoom >= 70) ?? 600; // seconds between labels
    const corner = ruler.querySelector('.tl-corner'); // the add-track button lives in the ruler and must survive a redraw of the ticks
    ruler.replaceChildren();
    for (let s = 0; s * p.fps < end; s += step) ruler.append(h('span', { class: 'tl-tick', style: { left: `${this.pad + s * p.fps * zoom}px` } }, fmtTime(s * p.fps, p.fps).replace(/\.\d+$/, '')));
    if (corner) ruler.append(corner);
  }

  /**
   * Zoom without rebuilding anything: move and resize the elements that are already there. Rebuilding would remove the
   * element a finger is touching, and the browser then stops sending touch events, which broke pinch-to-zoom.
   */
  private applyZoom(): void {
    const z = this.store.zoom;
    this.content.style.width = `${this.contentWidth()}px`;
    for (const el of this.content.querySelectorAll<HTMLElement>('[data-start]')) {
      el.style.left = `${this.pad + Number(el.dataset.start) * z}px`;
      el.style.width = `${Math.max(2, Number(el.dataset.dur) * z)}px`;
    }
    for (const el of this.content.querySelectorAll<HTMLElement>('[data-edge]')) el.style.left = `${this.pad + Number(el.dataset.edge) * z - 16}px`;
    const ruler = this.content.querySelector<HTMLElement>('.tl-ruler');
    if (ruler) this.fillRuler(ruler);
    this.movePlayhead(true);
  }

  render(): void {
    const { project: p } = this.store;
    const view = this.scroller.clientWidth;
    this.pad = this.touch ? Math.round(view / 2) : HEAD_W;
    const content = h('div', { class: 'tl-content', style: { width: `${this.contentWidth()}px` } });

    const ruler = h('div', { class: 'tl-ruler' });
    this.fillRuler(ruler);
    if (!this.touch) ruler.addEventListener('pointerdown', (e) => this.scrub(e));
    ruler.append(this.addTrackButton());
    content.append(ruler);

    // Within a kind the highest track is on top (higher layers above). The setting picks which kind is on top.
    const videoOnTop = this.store.settings.videoOnTop;
    const ordered = [...p.tracks].reverse().sort((a, b) => (a.kind === b.kind ? 0 : (a.kind === 'video') === videoOnTop ? -1 : 1));
    for (const track of ordered) content.append(this.trackRow(track));
    content.append(this.captionRow());
    if (!this.touch) content.append(this.playhead);

    this.content.replaceWith(content);
    this.content = content;
    this.movePlayhead(true);
  }

  private trackRow(track: Track): HTMLElement {
    const { selected } = this.store;
    const badges: IconName[] = [...(track.hidden ? ['eyeOff' as const] : []), ...(track.muted ? ['volumeOff' as const] : []), ...(track.locked ? ['lock' as const] : [])];
    const head = h('button', { class: 'tl-head', 'aria-label': `Track ${track.name} options`, title: 'Track options' }, track.name, badges.length ? h('small', { class: 'tl-badges' }, ...badges.map((b) => icon(b, 11))) : null);
    head.addEventListener('click', (e) => {
      e.stopPropagation();
      this.store.setActiveTrack(track.id);
      this.trackMenu(track, head);
    });
    const state = [track.id === this.store.activeTrack ? 'active' : '', track.locked ? 'locked' : '', track.hidden ? 'off' : '', track.muted ? 'off' : ''].filter(Boolean).join(' ');
    const row = h('div', { class: `tl-track tl-${track.kind} ${state}`.trim(), 'data-track': track.id }, head);
    let selectedClip: Clip | null = null;
    for (const clip of track.clips) {
      const asset = this.store.project.assets[clip.assetId];
      const isSel = clip.id === selected;
      if (isSel) selectedClip = clip;
      const el = h(
        'div',
        { class: `tl-clip${isSel ? ' sel' : ''}${clip.muted ? ' muted' : ''}${clip.text ? ' tl-text' : ''}`, 'data-start': clip.start, 'data-dur': clip.duration, style: { left: `${this.pad + this.px(clip.start)}px`, width: `${Math.max(2, this.px(clip.duration))}px` }, title: asset?.name },
        h('span', { class: 'tl-name' }, clip.text ? `T  ${clip.text.content}` : (asset?.name ?? '')),
        clip.effects.length ? h('span', { class: 'tl-fx' }, 'fx') : null,
        Object.values(clip.keys).some((k) => k?.length) ? h('span', { class: 'tl-fx' }, '◆') : null,
      );
      if (track.kind === 'audio' && asset?.hasAudio && this.store.settings.waveforms) this.addWaveform(el, clip, asset.duration);
      if (this.touch) {
        // Unselected clips only react to a tap, so a finger dragged across them pans the timeline natively.
        el.addEventListener('click', () => this.store.select(clip.id));
        if (isSel) el.addEventListener('pointerdown', (e) => this.clipDrag(e, clip, track, 'move'));
      } else el.addEventListener('pointerdown', (e) => this.clipDrag(e, clip, track));
      row.append(el);
    }
    if (this.touch && selectedClip && !track.locked) {
      for (const side of ['left', 'right'] as const) {
        const x = this.pad + this.px(side === 'left' ? selectedClip.start : clipEnd(selectedClip));
        const handle = h('div', { class: `tl-handle ${side}`, 'data-edge': side === 'left' ? selectedClip.start : clipEnd(selectedClip), style: { left: `${x - 16}px` }, 'aria-label': side === 'left' ? 'Trim start' : 'Trim end' }, h('i'));
        const c = selectedClip;
        handle.addEventListener('pointerdown', (e) => this.clipDrag(e, c, track, side));
        row.append(handle);
      }
    }
    row.addEventListener('click', (e) => {
      if (e.target !== row) return;
      this.store.clearSelection();
      this.store.setActiveTrack(track.id);
    });
    if (!this.touch) {
      row.addEventListener('pointerdown', (e) => {
        if (e.target !== row) return;
        this.store.clearSelection();
        this.scrub(e);
      });
    }
    return row;
  }

  /** A low-detail waveform inside an audio clip, drawn from peaks that are computed once in the background. */
  private addWaveform(el: HTMLElement, clip: Clip, assetFrames: number): void {
    const { project: p, lib } = this.store;
    const canvas = h('canvas', { class: 'tl-wave', width: Math.min(2048, Math.max(32, Math.round(this.px(clip.duration)))), height: 40 });
    el.prepend(canvas);
    const fg = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim() || '0 0% 20%';
    void lib.peaks(clip.assetId, assetFrames / p.fps).then((peaks) => {
      const from = clip.sourceIn / p.fps;
      drawWave(canvas, peaks, from, from + (clip.duration * clip.speed) / p.fps, `hsl(${fg} / 0.55)`);
    });
  }

  /** Small pop-up with what can be done to a track. */
  private trackMenu(track: Track, anchor: HTMLElement): void {
    const acts = this.opts.trackActions;
    if (!acts) return;
    const last = this.store.project.tracks.filter((t) => t.kind === track.kind).length <= 1;
    popupMenu(anchor, [
      track.kind === 'video'
        ? { label: track.hidden ? 'Show this track' : 'Hide this track', run: () => acts.toggle(track.id, 'hidden') }
        : { label: track.muted ? 'Unmute this track' : 'Mute this track', run: () => acts.toggle(track.id, 'muted') },
      { label: track.locked ? 'Unlock this track' : 'Lock this track', run: () => acts.toggle(track.id, 'locked') },
      { label: 'Delete this track', run: () => acts.remove(track.id), disabled: track.clips.length > 0 || last },
    ]);
  }

  /** The timeline frame under a screen x position (for dropping from the media bin). */
  frameAtClientX(clientX: number): number {
    return Math.max(0, Math.round((clientX - this.content.getBoundingClientRect().left - this.pad) / this.store.zoom));
  }

  private captionRow(): HTMLElement {
    const { project: p } = this.store;
    const active = this.store.activeTrack === CAPTION_TRACK;
    const head = h('button', { class: 'tl-head', 'aria-label': 'Caption track', title: 'Select the caption track (Split cuts captions here)' }, 'CC');
    head.addEventListener('click', (e) => {
      e.stopPropagation();
      this.store.clearSelection();
      this.store.setActiveTrack(CAPTION_TRACK);
    });
    const row = h('div', { class: `tl-track tl-caption${active ? ' active' : ''}`, 'data-track': CAPTION_TRACK }, head);
    for (const cue of p.captions) {
      const el = h('div', { class: `tl-clip tl-cue${cue.id === this.store.selectedCue ? ' sel' : ''}`, 'data-start': cue.start, 'data-dur': cue.end - cue.start, style: { left: `${this.pad + this.px(cue.start)}px`, width: `${Math.max(2, this.px(cue.end - cue.start))}px` }, title: cue.text }, h('span', { class: 'tl-name' }, cue.text));
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.store.selectCue(cue.id);
        this.store.seek(cue.start);
      });
      row.append(el);
    }
    // A press on the empty part of the row lets go of the caption (and makes this the track Split works on), as it does for the other tracks.
    row.addEventListener('click', (e) => {
      if (e.target !== row) return;
      this.store.clearSelection();
      this.store.setActiveTrack(CAPTION_TRACK);
    });
    if (!this.touch) {
      row.addEventListener('pointerdown', (e) => {
        if (e.target !== row) return;
        this.scrub(e);
      });
    }
    return row;
  }

  /** The "+ track" button sits in the empty corner above the track labels, left of the time ruler, and stays there when the timeline scrolls sideways. */
  private addTrackButton(): HTMLElement {
    const btn = h('button', { class: 'tl-corner', 'aria-label': 'Add a track', title: 'Add a track' }, icon('plus', 16));
    btn.addEventListener('pointerdown', (e) => e.stopPropagation()); // not a scrub
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const acts = this.opts.trackActions;
      if (!acts) return;
      popupMenu(btn, [
        { label: 'Add a video track', run: () => acts.add('video') },
        { label: 'Add an audio track', run: () => acts.add('audio') },
      ]);
    });
    return btn;
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
    if (track.locked) return store.select(clip.id); // a locked track can be selected but not changed
    // Measure BEFORE selecting: selecting re-renders the timeline and detaches this element, and a detached element
    // measures as zero, which made every grab look like the end handle.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mode: 'move' | 'left' | 'right' = forced ?? (e.clientX - rect.left < EDGE ? 'left' : rect.right - e.clientX < EDGE ? 'right' : 'move');
    store.select(clip.id);
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
        // Try snapping the clip's start and its end. A candidate that snapped beats one that did not; if both snapped, the nearer wins.
        const a = this.snap(start, points);
        const b = this.snap(start + cur.duration, points) - cur.duration;
        const aSnapped = a !== start;
        const bSnapped = b !== start;
        if (aSnapped && bSnapped) start = Math.abs(a - start) <= Math.abs(b - start) ? a : b;
        else if (aSnapped) start = a;
        else if (bSnapped) start = b;
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

  /** Zoom while keeping the frame under `clientX` where it is, so the timeline grows around the cursor. */
  private zoomAt(newZoom: number, clientX: number): void {
    const s = this.scroller;
    const x = clientX - s.getBoundingClientRect().left;
    const frame = (s.scrollLeft + x - this.pad) / this.store.zoom;
    this.store.setZoom(newZoom); // re-renders synchronously
    if (!this.touch) s.scrollLeft = Math.max(0, this.pad + frame * this.store.zoom - x);
  }

  /**
   * The wheel moves along the footage (sideways); Ctrl or Alt + wheel zooms (a laptop pinch arrives as Ctrl+wheel);
   * Shift + wheel scrolls the tracks up and down when there are more than fit. A trackpad's own sideways swipe is kept.
   */
  private onWheel(e: WheelEvent): void {
    if (e.ctrlKey || e.altKey) {
      e.preventDefault();
      this.zoomAt(this.store.zoom * Math.exp(-e.deltaY * 0.0022), e.clientX);
      return;
    }
    if (this.touch) return; // a finger scrolls natively
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.scroller.clientHeight : 1; // lines and pages to pixels
    const dy = e.deltaY * unit;
    const dx = e.deltaX * unit;
    e.preventDefault();
    if (e.shiftKey) this.scroller.scrollTop += dy || dx;
    else this.scroller.scrollLeft += Math.abs(dx) > Math.abs(dy) ? dx : dy;
  }

  /** Two fingers on the timeline: spread to zoom in, pinch to zoom out, around the playhead in the middle. */
  private setupPinch(): void {
    let start: { dist: number; zoom: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const s = this.scroller;
    s.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        start = { dist: dist(e.touches), zoom: this.store.zoom };
        this.pinching = true;
        this.opts.onUserTouch?.();
      }
    }, { passive: true });
    s.addEventListener('touchmove', (e) => {
      if (!start || e.touches.length !== 2) return;
      if (e.cancelable) e.preventDefault(); // once the browser has begun scrolling this cannot be cancelled; the scroll is ignored below
      const mid = (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2;
      this.zoomAt(start.zoom * (dist(e.touches) / start.dist), this.touch ? s.getBoundingClientRect().left + s.clientWidth / 2 : mid);
    }, { passive: false });
    const end = (e: TouchEvent) => {
      if (e.touches.length < 2 && start) {
        start = null;
        this.pinching = false;
        this.movePlayhead(true);
      }
    };
    s.addEventListener('touchend', end, { passive: true });
    s.addEventListener('touchcancel', end, { passive: true });
  }

  /** Touch: the person scrolled the timeline, so that is the new playhead position. */
  private onScroll(): void {
    if (!this.touch || this.dragging || this.pinching) return;
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

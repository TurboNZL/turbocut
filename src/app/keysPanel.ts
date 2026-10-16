import { paramsFor, valueAt, type Param } from '../core/animation.ts';
import { removeKeyframe, setKeyframe } from '../core/keyframes.ts';
import { findClip } from '../core/timeline.ts';
import type { Clip, Easing, Keyframe } from '../core/types.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import type { Store } from './store.ts';

const LABEL_W = 78;
const EASINGS: [Easing, string][] = [['inOut', 'Smooth'], ['linear', 'Linear'], ['in', 'Ease in'], ['out', 'Ease out'], ['hold', 'Hold (step)'], ['bounce', 'Bounce']];

/**
 * Keyframe editor ("dopesheet"): one row per animatable setting of the selected clip, a diamond per keyframe laid out
 * along the clip. Tap a diamond to select it and jump there, drag it sideways to change its time, tap a row's name to
 * add or remove a keyframe at the playhead. The strip below edits the selected keyframe's time, value and easing.
 */
export class KeysPanel {
  readonly el = h('section', { class: 'keys card bt-panel' });
  private sel: { param: string; t: number } | null = null;
  /** The fold is open (kept between clips; a clip that already has keyframes opens it anyway). */
  private open = false;
  private dragging = false;
  private grid: HTMLElement | null = null;
  private ppf = 1;

  constructor(private store: Store, private jump: (dir: 1 | -1) => void) {
    store.on('selection', () => ((this.sel = null), this.render()));
    store.on('project', () => !this.dragging && this.render());
    store.on('playhead', () => this.movePlayhead());
    // Only a change of WIDTH matters (the diamonds are laid out across it), and rebuilding changes the height: redrawing from inside the
    // observer callback would loop, so wait for the next frame.
    let lastW = 0;
    new ResizeObserver(() => {
      const w = this.el.clientWidth;
      if (w === lastW || this.dragging) return;
      lastW = w;
      requestAnimationFrame(() => this.render());
    }).observe(this.el);
    this.render();
  }

  private clip(): Clip | null {
    return this.store.selected ? (findClip(this.store.project, this.store.selected)?.clip ?? null) : null;
  }

  private params(): Param[] {
    return paramsFor(findClip(this.store.project, this.store.selected ?? '')?.track.kind ?? 'video');
  }

  private rel(): number {
    return this.store.playhead - (this.clip()?.start ?? 0);
  }

  private rendering = false;

  private render(): void {
    // Rebuilding removes the focused input, which can fire another change event and ask for another rebuild while this one is
    // half done. Ignore that nested request: the rebuild already in progress shows the current state.
    if (this.rendering) return;
    this.rendering = true;
    try {
      this.build();
    } finally {
      this.rendering = false;
    }
  }

  private build(): void {
    const clip = this.clip();
    this.el.replaceChildren();
    this.grid = null;
    if (!clip) {
      return; // the Clip tab above already says to select a clip

    }
    const fps = this.store.project.fps;
    const D = Math.max(1, clip.duration);
    const gridW = Math.max(220, (this.el.clientWidth || 300) - 4);
    const trackW = gridW - LABEL_W - 12;
    this.ppf = trackW / D;

    const nav = h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => this.jump(-1), title: 'Previous keyframe (,)' }, '◀ Key'),
      h('button', { class: 'btn', onclick: () => this.jump(1), title: 'Next keyframe (.)' }, 'Key ▶'),
      h('span', { class: 'hint' }, 'Tap a name to add a key here.'));

    const grid = h('div', { class: 'ks-grid', style: { width: `${gridW}px` } });
    // ruler
    const ruler = h('div', { class: 'ks-ruler' });
    const step = [1, 5, 10, 15, 30, 60, 150, 300, 900].find((s) => s * this.ppf >= 46) ?? 1800;
    for (let t = 0; t <= D; t += step) ruler.append(h('span', { class: 'ks-tick', style: { left: `${LABEL_W + t * this.ppf}px` } }, `${(t / fps).toFixed(t % fps ? 1 : 0)}s`));
    ruler.addEventListener('pointerdown', (e) => this.seekFrom(e, ruler));
    grid.append(ruler);

    for (const param of this.params()) {
      const track = h('div', { class: 'ks-track' });
      for (const k of param.keys(clip) ?? []) track.append(this.diamond(param, k));
      track.addEventListener('pointerdown', (e) => e.target === track && this.seekFrom(e, track));
      const label = h('button', { class: 'ks-label btn btn-ghost', title: `Add or remove a ${param.label} keyframe at the playhead` }, param.label.replace(' %', ''));
      label.addEventListener('click', () => this.toggleAtPlayhead(param));
      grid.append(h('div', { class: 'ks-row', 'data-param': param.id }, label, track));
    }
    grid.append(h('div', { class: 'ks-ph' }));
    this.grid = grid;
    // Folded away until wanted: the sliders above already set a value and add a key; this is for moving keys in time.
    const fold = h('details', { class: 'ks-fold' }, h('summary', {}, 'Keyframes', icon('chevron', 14)), h('div', { class: 'ks-body' }, nav, grid, this.details()));
    fold.open = this.open || Object.values(clip.keys).some((k) => k?.length);
    fold.addEventListener('toggle', () => (this.open = fold.open));
    this.el.append(fold);
    this.movePlayhead();
  }

  private movePlayhead(): void {
    const ph = this.grid?.querySelector<HTMLElement>('.ks-ph');
    const clip = this.clip();
    if (!ph || !clip) return;
    const rel = this.rel();
    ph.style.display = rel < 0 || rel > clip.duration ? 'none' : '';
    ph.style.left = `${LABEL_W + Math.max(0, Math.min(clip.duration, rel)) * this.ppf}px`;
  }

  private seekFrom(e: PointerEvent, ref: HTMLElement): void {
    const clip = this.clip();
    if (!clip) return;
    const at = (ev: PointerEvent) => {
      const x = ev.clientX - ref.getBoundingClientRect().left - (ref.classList.contains('ks-ruler') ? LABEL_W : 0);
      return Math.max(0, Math.min(clip.duration, Math.round(x / this.ppf)));
    };
    this.store.seek(clip.start + at(e));
    const move = (ev: PointerEvent) => this.store.seek(clip.start + at(ev));
    const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up));
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private toggleAtPlayhead(param: Param): void {
    const clip = this.clip();
    if (!clip) return;
    const t = this.rel();
    if (t < 0 || t > clip.duration) return this.store.say('Move the playhead inside the clip first.');
    this.store.begin();
    const keys = param.keys(clip);
    if (keys?.some((k) => k.t === t)) {
      const left = removeKeyframe(keys, t);
      if (!left.length) param.setBase(clip, valueAt(param, clip, t));
      param.setKeys(clip, left.length ? left : undefined);
      this.sel = null;
    } else {
      param.setKeys(clip, setKeyframe(keys, { t, v: valueAt(param, clip, t), ease: 'inOut' }));
      this.sel = { param: param.id, t };
    }
    this.store.emit('project');
  }

  private diamond(param: Param, k: Keyframe): HTMLElement {
    const sel = this.sel?.param === param.id && this.sel.t === k.t;
    const el = h('button', { class: `ks-key${sel ? ' sel' : ''}`, style: { left: `${k.t * this.ppf}px` }, 'aria-label': `${param.label} keyframe at frame ${k.t}` }, '◆');
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const clip = this.clip();
      if (!clip) return;
      this.sel = { param: param.id, t: k.t };
      this.grid?.querySelectorAll('.ks-key.sel').forEach((x) => x.classList.remove('sel'));
      el.classList.add('sel');
      this.refreshDetails();
      const startX = e.clientX;
      const t0 = k.t;
      let moved = false;
      const move = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientX - startX) < 4) return;
        if (!moved) {
          moved = true;
          this.dragging = true;
          this.store.begin();
        }
        const keys = param.keys(clip)!;
        const t = Math.max(0, Math.min(clip.duration, Math.round(t0 + (ev.clientX - startX) / this.ppf)));
        if (t === k.t || keys.some((o) => o !== k && o.t === t)) return; // never two keys on one frame
        k.t = t;
        keys.sort((a, b) => a.t - b.t);
        this.sel = { param: param.id, t };
        el.style.left = `${t * this.ppf}px`;
        this.store.seek(clip.start + t); // the preview shows the moved key
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (moved) {
          this.dragging = false;
          this.store.emit('project');
        } else this.store.seek(clip.start + k.t);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
    return el;
  }

  private detailsBox = h('div', { class: 'ks-details' });

  private details(): HTMLElement {
    this.detailsBox = h('div', { class: 'ks-details' });
    this.refreshDetails();
    return this.detailsBox;
  }

  private selectedKey(): { param: Param; key: Keyframe; clip: Clip } | null {
    const clip = this.clip();
    if (!clip || !this.sel) return null;
    const param = this.params().find((p) => p.id === this.sel!.param);
    const key = param?.keys(clip)?.find((k) => k.t === this.sel!.t);
    return param && key ? { param, key, clip } : null;
  }

  private refreshDetails(): void {
    const box = this.detailsBox;
    box.replaceChildren();
    const s = this.selectedKey();
    if (!s) {
      box.append(h('p', { class: 'hint' }, 'Tap a diamond to edit that keyframe.'));
      return;
    }
    const { param, key, clip } = s;
    const store = this.store;
    const fps = store.project.fps;
    const time = h('input', { type: 'number', class: 'input num', min: 0, max: clip.duration, step: 1, value: key.t, 'aria-label': 'Keyframe frame' });
    time.addEventListener('change', () => {
      const t = Math.max(0, Math.min(clip.duration, Math.round(Number(time.value))));
      if (t === key.t) return;
      if (param.keys(clip)!.some((o) => o !== key && o.t === t)) return store.say('There is already a keyframe on that frame.');
      store.edit(() => {
        key.t = t;
        param.keys(clip)!.sort((a, b) => a.t - b.t);
      });
      this.sel = { param: param.id, t };
      store.seek(clip.start + t);
    });
    const value = h('input', { type: 'number', class: 'input num', min: param.min * param.scale, max: param.max * param.scale, step: param.step * param.scale, value: +(key.v * param.scale).toFixed(2), 'aria-label': 'Keyframe value' });
    let burst = false;
    value.addEventListener('input', () => {
      const v = Number(value.value);
      if (!Number.isFinite(v)) return;
      if (!burst) (store.begin(), (burst = true));
      key.v = Math.min(param.max, Math.max(param.min, v / param.scale));
      store.emit('playhead'); // refresh the preview and the inspector without rebuilding this panel
    });
    value.addEventListener('change', () => ((burst = false), store.emit('project')));
    const ease = h('select', { class: 'input', 'aria-label': 'Easing to the next keyframe' }, ...EASINGS.map(([v, l]) => h('option', { value: v, selected: key.ease === v }, l)));
    ease.addEventListener('change', () => store.edit(() => (key.ease = ease.value as Easing)));
    const del = h('button', { class: 'btn', onclick: () => {
      store.edit(() => {
        const left = removeKeyframe(param.keys(clip), key.t);
        if (!left.length) param.setBase(clip, key.v);
        param.setKeys(clip, left.length ? left : undefined);
      });
      this.sel = null;
      this.render();
    } }, 'Delete keyframe');
    box.append(
      h('h2', { class: 'bt-panel-title' }, `${param.label.replace(' %', '')} keyframe`),
      h('label', { class: 'prop' }, h('span', { class: 'prop-l' }, 'Frame'), time, h('span', { class: 'unit' }, `${(key.t / fps).toFixed(2)} s`)),
      h('label', { class: 'prop' }, h('span', { class: 'prop-l' }, 'Value'), value),
      h('label', { class: 'prop' }, h('span', { class: 'prop-l' }, 'Then'), ease),
      del,
    );
  }
}

import { evalProp, removeKeyframe, setKeyframe } from '../core/keyframes.ts';
import { findClip } from '../core/timeline.ts';
import type { AnimProp, Clip } from '../core/types.ts';
import { h, rangeFill } from './dom.ts';
import type { Store } from './store.ts';

interface Row {
  label: string;
  prop: AnimProp;
  min: number;
  max: number;
  step: number;
  /** Convert between the stored value and what the person sees (for example opacity 0..1 as percent). */
  show?: (v: number) => number;
  store?: (v: number) => number;
}

const ROWS: Row[] = [
  { label: 'Zoom', prop: 'scale', min: 0.2, max: 4, step: 0.01 },
  { label: 'X', prop: 'x', min: -1500, max: 1500, step: 1 },
  { label: 'Y', prop: 'y', min: -1500, max: 1500, step: 1 },
  { label: 'Rotate', prop: 'rotation', min: -180, max: 180, step: 0.5 },
  { label: 'Opacity %', prop: 'opacity', min: 0, max: 100, step: 1, show: (v) => v * 100, store: (v) => v / 100 },
];

export class Inspector {
  readonly el = h('div', { class: 'insp' });
  private refreshers: (() => void)[] = [];
  private builtFor: string | null | undefined = undefined;

  constructor(private store: Store) {
    store.on('selection', () => this.build());
    store.on('project', () => this.refresh());
    store.on('playhead', () => this.refresh());
    this.build();
  }

  private clip(): Clip | null {
    return this.store.selected ? (findClip(this.store.project, this.store.selected)?.clip ?? null) : null;
  }

  private build(): void {
    const clip = this.clip();
    if ((clip?.id ?? null) === this.builtFor) return this.refresh();
    this.builtFor = clip?.id ?? null;
    this.refreshers = [];
    this.el.replaceChildren();
    if (!clip) {
      this.el.append(h('p', { class: 'hint' }, 'Select a clip on the timeline to edit it.'));
      return;
    }
    const asset = this.store.project.assets[clip.assetId];
    this.el.append(h('div', { class: 'bt-panel-title' }, asset?.name ?? 'Clip'));
    const isVideo = findClip(this.store.project, clip.id)?.track.kind === 'video';
    if (isVideo) {
      for (const row of ROWS) this.el.append(this.propRow(row));
      this.el.append(this.effects(), this.speed());
    } else {
      this.el.append(this.propRow({ label: 'Volume %', prop: 'volume', min: 0, max: 200, step: 1, show: (v) => v * 100, store: (v) => v / 100 }), this.fades());
    }
    this.refresh();
  }

  private refresh(): void {
    this.refreshers.forEach((r) => r());
  }

  private edit(): void {
    if (!this.dirty) {
      this.store.begin();
      this.dirty = true;
    }
  }
  private dirty = false;

  private propRow(r: Row): HTMLElement {
    const store = this.store;
    const num = h('input', { type: 'number', class: 'input num', min: r.min, max: r.max, step: r.step });
    const range = h('input', { type: 'range', class: 'bt-range', min: r.min, max: r.max, step: r.step });
    const key = h('button', { class: 'btn btn-ghost kf', title: 'Keyframe at playhead (K)', 'aria-label': `Keyframe ${r.label}` }, '◇');
    const show = r.show ?? ((v: number) => v);
    const to = r.store ?? ((v: number) => v);

    const relNow = () => store.playhead - (this.clip()?.start ?? 0);
    const apply = (shown: number) => {
      const clip = this.clip();
      if (!clip) return;
      this.edit();
      const v = to(Math.min(r.max, Math.max(r.min, shown)));
      if (clip.keys[r.prop]?.length) clip.keys[r.prop] = setKeyframe(clip.keys[r.prop], { t: relNow(), v, ease: 'inOut' });
      else clip.base[r.prop] = v;
      store.emit('project');
    };
    for (const el of [num, range]) {
      el.addEventListener('input', () => apply(Number(el.value)));
      el.addEventListener('change', () => (this.dirty = false));
    }
    key.addEventListener('click', () => {
      const clip = this.clip();
      if (!clip) return;
      store.begin();
      const keys = clip.keys[r.prop];
      const t = relNow();
      if (keys?.some((k) => k.t === t)) {
        const left = removeKeyframe(keys, t);
        if (left.length) clip.keys[r.prop] = left;
        else {
          clip.base[r.prop] = evalProp(clip, r.prop, store.playhead);
          delete clip.keys[r.prop];
        }
      } else clip.keys[r.prop] = setKeyframe(keys, { t, v: evalProp(clip, r.prop, store.playhead), ease: 'inOut' });
      store.emit('project');
    });

    this.refreshers.push(() => {
      const clip = this.clip();
      if (!clip) return;
      const v = show(evalProp(clip, r.prop, store.playhead));
      const text = String(+v.toFixed(2));
      if (document.activeElement !== num) num.value = text;
      range.value = String(v);
      rangeFill(range);
      const keys = clip.keys[r.prop];
      key.textContent = keys?.some((k) => k.t === store.playhead - clip.start) ? '◆' : keys?.length ? '◈' : '◇';
      key.classList.toggle('on', !!keys?.length);
    });
    return h('label', { class: 'prop' }, h('span', { class: 'prop-l' }, r.label), range, num, r.prop === 'volume' ? null : key);
  }

  private effects(): HTMLElement {
    const store = this.store;
    const blur = h('input', { type: 'range', class: 'bt-range', min: 0, max: 80, step: 1 });
    const pix = h('input', { type: 'range', class: 'bt-range', min: 0, max: 120, step: 1 });
    const get = (kind: 'gaussian' | 'pixelate') => this.clip()?.effects.find((e) => e.kind === kind)?.radius ?? 0;
    const set = (kind: 'gaussian' | 'pixelate', v: number) => {
      const clip = this.clip();
      if (!clip) return;
      this.edit();
      clip.effects = clip.effects.filter((e) => e.kind !== kind);
      if (v > 0) clip.effects.push({ type: 'blur', kind, radius: v });
      store.emit('project');
    };
    blur.addEventListener('input', () => set('gaussian', Number(blur.value)));
    pix.addEventListener('input', () => set('pixelate', Number(pix.value)));
    for (const el of [blur, pix]) el.addEventListener('change', () => (this.dirty = false));
    this.refreshers.push(() => {
      blur.value = String(get('gaussian'));
      pix.value = String(get('pixelate'));
      rangeFill(blur);
      rangeFill(pix);
    });
    return h('div', { class: 'fx-box' }, h('label', { class: 'prop' }, h('span', { class: 'prop-l' }, 'Blur'), blur), h('label', { class: 'prop' }, h('span', { class: 'prop-l' }, 'Pixelate'), pix));
  }

  private speed(): HTMLElement {
    const sel = h('select', { class: 'input' }, ...[0.25, 0.5, 1, 1.5, 2, 4].map((s) => h('option', { value: String(s) }, `${s}×`)));
    sel.addEventListener('change', () => {
      const clip = this.clip();
      if (!clip) return;
      const v = Number(sel.value);
      this.store.edit((p) => {
        const c = findClip(p, clip.id)!.clip;
        // Keep the same stretch of source: duration scales inversely with speed.
        c.duration = Math.max(1, Math.round((c.duration * c.speed) / v));
        c.speed = v;
      });
    });
    this.refreshers.push(() => (sel.value = String(this.clip()?.speed ?? 1)));
    return h('label', { class: 'prop' }, h('span', { class: 'prop-l' }, 'Speed'), sel);
  }

  private fades(): HTMLElement {
    const store = this.store;
    const mk = (label: string, field: 'audioFadeIn' | 'audioFadeOut') => {
      const inp = h('input', { type: 'number', class: 'input num', min: 0, max: 30, step: 0.1 });
      inp.addEventListener('change', () => {
        const clip = this.clip();
        if (!clip) return;
        store.edit((p) => {
          const c = findClip(p, clip.id)!.clip;
          c[field] = Math.min(c.duration, Math.max(0, Math.round(Number(inp.value) * p.fps)));
        });
      });
      this.refreshers.push(() => {
        if (document.activeElement !== inp) inp.value = String(+((this.clip()?.[field] ?? 0) / store.project.fps).toFixed(2));
      });
      return h('label', { class: 'prop' }, h('span', { class: 'prop-l' }, label), inp, h('span', { class: 'unit' }, 's'));
    };
    const mute = h('button', { class: 'btn' }, 'Mute');
    mute.addEventListener('click', () => {
      const clip = this.clip();
      if (clip) store.edit((p) => (findClip(p, clip.id)!.clip.muted = !clip.muted));
    });
    this.refreshers.push(() => (mute.textContent = this.clip()?.muted ? 'Unmute' : 'Mute'));
    return h('div', { class: 'fx-box' }, mk('Fade in', 'audioFadeIn'), mk('Fade out', 'audioFadeOut'), mute);
  }

  /** K: toggle a keyframe on the main properties at the playhead. */
  keyframeAll(): void {
    const clip = this.clip();
    if (!clip) return;
    const t = this.store.playhead - clip.start;
    if (t < 0 || t >= clip.duration) return;
    this.store.edit((p) => {
      const c = findClip(p, clip.id)!.clip;
      for (const prop of ['scale', 'x', 'y'] as AnimProp[]) c.keys[prop] = setKeyframe(c.keys[prop], { t, v: evalProp(c, prop, this.store.playhead), ease: 'inOut' });
    });
  }
}

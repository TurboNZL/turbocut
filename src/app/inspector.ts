import { keyTimes, neighbourKey, paramsFor, valueAt, type Param } from '../core/animation.ts';
import { removeKeyframe, setKeyframe } from '../core/keyframes.ts';
import { findClip } from '../core/timeline.ts';
import type { Clip } from '../core/types.ts';
import { h, rangeFill } from './dom.ts';
import { styleControls } from './styleControls.ts';
import type { Store } from './store.ts';

/** Settings of the selected clip. Every animatable setting gets a slider, a number and a keyframe button. */
export class Inspector {
  readonly el = h('div', { class: 'insp' });
  private refreshers: (() => void)[] = [];
  private builtFor: string | null | undefined = undefined;
  private dirty = false;

  constructor(private store: Store) {
    store.on('selection', () => this.build());
    store.on('project', () => this.refresh());
    store.on('playhead', () => this.refresh());
    this.build();
  }

  private clip(): Clip | null {
    return this.store.selected ? (findClip(this.store.project, this.store.selected)?.clip ?? null) : null;
  }

  private kind(): 'video' | 'audio' {
    return findClip(this.store.project, this.store.selected ?? '')?.track.kind ?? 'video';
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
    const kind = this.kind();
    const asset = this.store.project.assets[clip.assetId];
    this.el.append(h('div', { class: 'bt-panel-title' }, clip.text ? 'Text layer' : (asset?.name ?? 'Clip')));
    if (clip.text) this.el.append(this.textSection(clip));
    for (const param of paramsFor(kind)) this.el.append(this.paramRow(param));
    if (kind === 'video' && !clip.text) this.el.append(this.speed());
    if (kind === 'audio') this.el.append(this.fades());
    this.refresh();
  }

  private refresh(): void {
    this.refreshers.forEach((r) => r());
  }

  /** One undo step for a whole drag of a slider. */
  private edit(): void {
    if (!this.dirty) {
      this.store.begin();
      this.dirty = true;
    }
  }

  private relNow(): number {
    return this.store.playhead - (this.clip()?.start ?? 0);
  }

  private paramRow(param: Param): HTMLElement {
    const store = this.store;
    const num = h('input', { type: 'number', class: 'input num', min: param.min * param.scale, max: param.max * param.scale, step: param.step * param.scale, 'aria-label': param.label });
    const range = h('input', { type: 'range', class: 'bt-range', min: param.min * param.scale, max: param.max * param.scale, step: param.step * param.scale, 'aria-label': `${param.label} slider` });
    const key = h('button', { class: 'btn btn-ghost kf', title: 'Keyframe at the playhead', 'aria-label': `Keyframe ${param.label}` }, '◇');

    const apply = (shown: number) => {
      const clip = this.clip();
      if (!clip) return;
      this.edit();
      const v = Math.min(param.max, Math.max(param.min, shown / param.scale));
      if (param.keys(clip)?.length) param.setKeys(clip, setKeyframe(param.keys(clip), { t: this.relNow(), v, ease: 'inOut' }));
      else param.setBase(clip, v);
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
      const keys = param.keys(clip);
      const t = this.relNow();
      if (keys?.some((k) => k.t === t)) {
        const left = removeKeyframe(keys, t);
        if (left.length) param.setKeys(clip, left);
        else {
          param.setBase(clip, valueAt(param, clip, t)); // keep the value it had when the last key goes
          param.setKeys(clip, undefined);
        }
      } else param.setKeys(clip, setKeyframe(keys, { t, v: valueAt(param, clip, t), ease: 'inOut' }));
      store.emit('project');
    });

    this.refreshers.push(() => {
      const clip = this.clip();
      if (!clip) return;
      const v = valueAt(param, clip, this.relNow()) * param.scale;
      if (document.activeElement !== num) num.value = String(+v.toFixed(2));
      range.value = String(v);
      rangeFill(range);
      const keys = param.keys(clip);
      key.textContent = keys?.some((k) => k.t === this.relNow()) ? '◆' : keys?.length ? '◈' : '◇';
      key.classList.toggle('on', !!keys?.length);
    });
    return h('label', { class: 'prop' }, h('span', { class: 'prop-l' }, param.label), range, num, key);
  }

  /** What the text says and how it looks. */
  private textSection(clip: Clip): HTMLElement {
    const store = this.store;
    const text = h('textarea', { class: 'input', rows: 2, 'aria-label': 'Text', value: clip.text!.content });
    text.addEventListener('input', () => {
      this.edit();
      clip.text!.content = text.value;
      store.emit('project');
    });
    text.addEventListener('change', () => (this.dirty = false));
    const controls = styleControls(clip.text!.style, { onBegin: () => this.edit(), onChange: () => store.emit('project'), fonts: undefined });
    controls.addEventListener('change', () => (this.dirty = false));
    return h('div', { class: 'stack' }, text, controls);
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

  /** K: toggle keyframes on zoom, X and Y at the playhead. */
  keyframeAll(): void {
    const clip = this.clip();
    if (!clip || this.kind() !== 'video') return;
    const t = this.relNow();
    if (t < 0 || t >= clip.duration) return;
    this.store.edit((p) => {
      const c = findClip(p, clip.id)!.clip;
      for (const param of paramsFor('video').filter((x) => ['scale', 'x', 'y'].includes(x.id))) param.setKeys(c, setKeyframe(param.keys(c), { t, v: valueAt(param, c, t), ease: 'inOut' }));
    });
  }

  /** Jump the playhead to the next or previous keyframe of the selected clip. */
  jumpKey(dir: 1 | -1): void {
    const clip = this.clip();
    if (!clip) return this.store.say('Select a clip first.');
    const times = keyTimes(clip, paramsFor(this.kind()));
    const t = neighbourKey(times, this.relNow(), dir);
    if (t === undefined) return this.store.say(times.length ? `No ${dir > 0 ? 'later' : 'earlier'} keyframe.` : 'This clip has no keyframes yet.');
    this.store.seek(clip.start + t);
  }
}

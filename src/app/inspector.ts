import { keyTimes, neighbourKey, paramsFor, valueAt, type Param } from '../core/animation.ts';
import { removeKeyframe, setKeyframe } from '../core/keyframes.ts';
import { findClip } from '../core/timeline.ts';
import type { Clip, Easing } from '../core/types.ts';

const EASE_LABEL: Record<Easing, string> = { inOut: 'Smooth', linear: 'Linear', in: 'Ease in', out: 'Ease out', hold: 'Hold (step)', bounce: 'Bounce' };
import { DEFAULT_ANIMATION } from '../captions/presets.ts';
import { h, popupMenu, rangeFill } from './dom.ts';
import { icon, setIcon } from './icons.ts';
import { styleControls } from './styleControls.ts';
import type { Store } from './store.ts';

/** Settings of the selected clip. Every animatable setting gets a slider, a number and a keyframe button. */
export class Inspector {
  readonly el = h('div', { class: 'insp card bt-panel' });
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
    const first = this.builtFor === undefined;
    this.builtFor = clip?.id ?? null;
    this.refreshers = [];
    this.el.replaceChildren();
    if (!first) {
      this.el.classList.remove('tk-swap');
      void this.el.offsetWidth;
      this.el.classList.add('tk-swap');
    }
    if (!clip) {
      this.el.append(h('p', { class: 'hint' }, 'Select a clip on the timeline to edit it.'));
      return;
    }
    const kind = this.kind();
    const asset = this.store.project.assets[clip.assetId];
    this.el.append(h('h2', { class: 'bt-panel-title' }, clip.text ? 'Text layer' : (asset?.name ?? 'Clip')));
    const multi = h('p', { class: 'hint' });
    this.refreshers.push(() => {
      const n = this.store.selectedIds.length;
      multi.textContent = n > 1 ? `${n} clips are selected. These settings change the first one; drag, split, delete and mute act on all of them.` : '';
      multi.style.display = n > 1 ? '' : 'none';
    });
    this.el.append(multi);
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

  /** The setting the person last worked on: the `,` and `.` keys jump between ITS keyframes. */
  private activeParam: string | null = null;
  /** The keyframe last clicked in a lane (highlighted, and the one the menu was opened on). */
  private selKey: { param: string; t: number } | null = null;
  private laneDragging = false;

  /**
   * One setting: its name, slider, number, and the keyframe controls for THAT setting (previous key, add/remove a key at
   * the playhead, next key). Once it has keyframes a thin lane under it shows them across the clip: click to move the
   * playhead, drag a diamond to move the key, right-click (or double-click) a diamond for its easing and Delete.
   */
  private paramRow(param: Param): HTMLElement {
    const store = this.store;
    const num = h('input', { type: 'number', class: 'input num', min: param.min * param.scale, max: param.max * param.scale, step: param.step * param.scale, 'aria-label': param.label });
    const range = h('input', { type: 'range', class: 'bt-range', min: param.min * param.scale, max: param.max * param.scale, step: param.step * param.scale, 'aria-label': `${param.label} slider` });
    const prev = h('button', { class: 'btn btn-ghost kf-nav', title: `Previous ${param.label} keyframe`, 'aria-label': `Previous ${param.label} keyframe` }, icon('chevron', 14));
    const next = h('button', { class: 'btn btn-ghost kf-nav', title: `Next ${param.label} keyframe`, 'aria-label': `Next ${param.label} keyframe` }, icon('chevron', 14));
    prev.classList.add('kf-prev');
    next.classList.add('kf-next');
    const key = h('button', { class: 'btn btn-ghost kf', title: 'Add or remove a keyframe at the playhead', 'aria-label': `Keyframe ${param.label}` }, icon('key', 16));
    const keys = h('span', { class: 'kf-group' }, prev, key, next);
    const lane = h('div', { class: 'kf-lane', 'data-param': param.id, style: { display: 'none' } });
    const row = h('label', { class: 'prop' }, h('span', { class: 'prop-l' }, param.label), range, num, keys);
    const block = h('div', { class: 'prop-block', 'data-param': param.id }, row, lane);
    const mark = () => {
      this.activeParam = param.id;
      this.el.querySelectorAll('.prop-block.active').forEach((x) => x !== block && x.classList.remove('active'));
      block.classList.add('active');
    };
    block.addEventListener('pointerdown', mark, true);
    block.addEventListener('focusin', mark);

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
    key.addEventListener('click', (e) => {
      e.preventDefault();
      const clip = this.clip();
      if (!clip) return;
      const t = this.relNow();
      if (t < 0 || t > clip.duration) return store.say('Move the playhead inside the clip first.');
      store.begin();
      const ks = param.keys(clip);
      if (ks?.some((k) => k.t === t)) {
        const left = removeKeyframe(ks, t);
        if (left.length) param.setKeys(clip, left);
        else {
          param.setBase(clip, valueAt(param, clip, t)); // keep the value it had when the last key goes
          param.setKeys(clip, undefined);
        }
        if (this.selKey?.param === param.id && this.selKey.t === t) this.selKey = null;
      } else {
        param.setKeys(clip, setKeyframe(ks, { t, v: valueAt(param, clip, t), ease: 'inOut' }));
        this.selKey = { param: param.id, t };
      }
      store.emit('project');
    });
    const jump = (dir: 1 | -1) => (e: Event) => {
      e.preventDefault();
      this.activeParam = param.id;
      this.jumpKey(dir, param.id);
    };
    prev.addEventListener('click', jump(-1));
    next.addEventListener('click', jump(1));

    // Pressing on the empty lane moves the playhead there (and dragging scrubs along it).
    lane.addEventListener('pointerdown', (e) => {
      if (e.target !== lane) return;
      const c = this.clip();
      if (!c) return;
      const at = (clientX: number) => c.start + Math.max(0, Math.min(c.duration, Math.round(((clientX - lane.getBoundingClientRect().left) / Math.max(1, lane.clientWidth)) * c.duration)));
      store.seek(at(e.clientX));
      const move = (ev: PointerEvent) => store.seek(at(ev.clientX));
      const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up));
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    let laneSig = '';
    this.refreshers.push(() => {
      const clip = this.clip();
      if (!clip) return;
      const v = valueAt(param, clip, this.relNow()) * param.scale;
      if (document.activeElement !== num) num.value = String(+v.toFixed(2));
      range.value = String(v);
      rangeFill(range);
      const ks = param.keys(clip);
      const rel = this.relNow();
      setIcon(key, ks?.some((k) => k.t === rel) ? 'keyOn' : ks?.length ? 'keyPart' : 'key', 16);
      key.classList.toggle('on', !!ks?.length);
      const times = (ks ?? []).map((k) => k.t);
      prev.disabled = !times.some((t) => t < rel);
      next.disabled = !times.some((t) => t > rel);
      lane.style.display = ks?.length ? '' : 'none';
      block.classList.toggle('keyed', !!ks?.length);
      // The lane is redrawn only when its keys changed; otherwise only the playhead line moves.
      const sig = `${clip.id}#${clip.duration}#${(ks ?? []).map((k) => `${k.t}:${k.ease}`).join(',')}#${this.selKey?.param === param.id ? this.selKey.t : ''}`;
      if (sig !== laneSig && !this.laneDragging) {
        laneSig = sig;
        this.drawLane(lane, param, clip);
      }
      const ph = lane.querySelector<HTMLElement>('.kf-ph');
      if (ph) {
        ph.style.left = `${(Math.max(0, Math.min(clip.duration, rel)) / Math.max(1, clip.duration)) * 100}%`;
        ph.style.display = rel < 0 || rel > clip.duration ? 'none' : '';
      }
    });
    return block;
  }

  /** The keyframes of one setting as diamonds along a thin lane the width of the clip. */
  private drawLane(lane: HTMLElement, param: Param, clip: Clip): void {
    const D = Math.max(1, clip.duration);
    const store = this.store;
    lane.replaceChildren(h('i', { class: 'kf-ph' }));
    const frameAt = (clientX: number) => Math.max(0, Math.min(clip.duration, Math.round(((clientX - lane.getBoundingClientRect().left) / lane.clientWidth) * D)));
    for (const k of param.keys(clip) ?? []) {
      const sel = this.selKey?.param === param.id && this.selKey.t === k.t;
      const dot = h('button', { class: `kf-dot${sel ? ' sel' : ''}`, style: { left: `${(k.t / D) * 100}%` }, 'aria-label': `${param.label} keyframe at frame ${k.t}`, title: `${(k.t / store.project.fps).toFixed(2)} s, ${EASE_LABEL[k.ease]} (right-click for more)` }, icon('keyOn', 14));
      dot.addEventListener('contextmenu', (e) => (e.preventDefault(), this.keyMenu(e.clientX, e.clientY, param, k.t)));
      dot.addEventListener('dblclick', (e) => this.keyMenu(e.clientX, e.clientY, param, k.t));
      dot.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        e.preventDefault();
        const c = this.clip();
        if (!c) return;
        this.selKey = { param: param.id, t: k.t };
        lane.querySelectorAll('.kf-dot.sel').forEach((x) => x.classList.remove('sel'));
        dot.classList.add('sel');
        const startX = e.clientX;
        let moved = false;
        let at = k.t; // the key is found again by its time: editing a value replaces the key objects
        const move = (ev: PointerEvent) => {
          if (!moved && Math.abs(ev.clientX - startX) < 4) return;
          if (!moved) {
            moved = true;
            this.laneDragging = true;
            store.begin();
          }
          const list = param.keys(c);
          const live = list?.find((o) => o.t === at);
          const t = frameAt(ev.clientX);
          if (!list || !live || t === at || list.some((o) => o !== live && o.t === t)) return; // never two keys on one frame
          live.t = t;
          at = t;
          list.sort((a, b) => a.t - b.t);
          this.selKey = { param: param.id, t };
          dot.style.left = `${(t / D) * 100}%`;
          store.seek(c.start + t); // the preview shows the moved key
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
          if (moved) {
            this.laneDragging = false;
            store.emit('project');
          } else store.seek(c.start + at);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      });
      lane.append(dot);
    }
  }

  /** Easing to the next keyframe, and Delete, for one keyframe. */
  private keyMenu(x: number, y: number, param: Param, t: number): void {
    const clip = this.clip();
    const k = clip && param.keys(clip)?.find((o) => o.t === t);
    if (!clip || !k) return;
    popupMenu({ x, y }, [
      ...(Object.keys(EASE_LABEL) as Easing[]).map((e) => ({ label: `${k.ease === e ? '✓ ' : '   '}${EASE_LABEL[e]}`, run: () => this.store.edit(() => (k.ease = e)) })),
      {
        label: 'Delete keyframe',
        run: () =>
          this.store.edit(() => {
            const left = removeKeyframe(param.keys(clip), t);
            if (!left.length) param.setBase(clip, k.v);
            param.setKeys(clip, left.length ? left : undefined);
            this.selKey = null;
          }),
      },
    ]);
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
    const controls = styleControls(clip.text!.style, { onBegin: () => this.edit(), onChange: () => store.emit('project') });
    controls.addEventListener('change', () => (this.dirty = false));
    // Pop in like captions do (the default), or appear and stay still.
    const entrance = h('select', { class: 'input', 'aria-label': 'Entrance animation' },
      h('option', { value: 'bounce' }, 'Pop in (bounce)'),
      h('option', { value: 'none' }, 'None (appears and stays still)'));
    entrance.value = clip.text!.animation.type;
    entrance.addEventListener('change', () => {
      store.begin();
      clip.text!.animation = entrance.value === 'none' ? { type: 'none' } : { ...DEFAULT_ANIMATION };
      store.emit('project');
    });
    return h('div', { class: 'stack' }, text, h('label', { class: 'prop style-row' }, h('span', { class: 'prop-l' }, 'Entrance'), entrance), controls);
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

  /**
   * Jump the playhead to the next or previous keyframe of one setting (the one worked on last, unless `only` names one).
   * With no setting chosen yet, to the next or previous keyframe of any setting.
   */
  jumpKey(dir: 1 | -1, only?: string): void {
    const clip = this.clip();
    if (!clip) return this.store.say('Select a clip first.');
    const params = paramsFor(this.kind());
    const which = only ?? (this.activeParam && params.some((p) => p.id === this.activeParam && p.keys(clip)?.length) ? this.activeParam : null);
    const list = which ? params.filter((p) => p.id === which) : params;
    const times = keyTimes(clip, list);
    const t = neighbourKey(times, this.relNow(), dir);
    const name = which ? params.find((p) => p.id === which)?.label.replace(' %', '') : null;
    if (t === undefined) return this.store.say(times.length ? `No ${dir > 0 ? 'later' : 'earlier'}${name ? ` ${name}` : ''} keyframe.` : name ? `${name} has no keyframes yet.` : 'This clip has no keyframes yet.');
    this.store.seek(clip.start + t);
  }
}

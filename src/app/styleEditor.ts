import type { AssStyle } from '../captions/ass.ts';
import type { CaptionPreset, EntranceAnimation } from '../captions/presets.ts';
import { createProject } from '../core/timeline.ts';
import { drawCaption } from '../render/captions.ts';
import { dialog, h } from './dom.ts';
import { loadStoredFonts } from './fonts.ts';
import { exportPresetDialog, pickAndImportPreset } from './presetIO.ts';
import type { Store } from './store.ts';
import { styleControls } from './styleControls.ts';

const SAMPLE = 'Your captions look like this';

/**
 * The style editor: pick a style, change its variants (colour, font, size, outline, position), its entrance animation,
 * and watch it on a live preview drawn by the same code that draws captions in the player and the export.
 */
export function openStyleEditor(store: Store): void {
  let variant = 0;
  const root = h('div', { class: 'style-editor' });
  const fontNames = ['Arial Black', 'Impact', 'Arial', 'Verdana', 'Georgia', 'Courier New'];
  void loadStoredFonts().then((f) => fontNames.push(...f));

  // Live preview: a 9:16 canvas at project size, scaled down by CSS.
  const pv = createProject({ width: 1080, height: 1920 });
  const canvas = h('canvas', { class: 'style-preview', width: 1080, height: 1920, 'aria-label': 'Style preview' });
  const ctx = canvas.getContext('2d')!;
  let raf = 0;
  const paint = (age: number) => {
    const p = store.preset;
    const v = p.styles[Math.min(variant, p.styles.length - 1)]!;
    pv.captions = [{ id: 'pv', start: 0, end: 100000, text: SAMPLE, style: v.name }];
    const g = ctx.createLinearGradient(0, 0, 1080, 1920);
    g.addColorStop(0, '#3a4a5c');
    g.addColorStop(1, '#8a6a4a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1080, 1920);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < 6; i++) ctx.fillRect(0, i * 320, 1080, 160); // stripes so outlines and holes read against a busy picture
    drawCaption(ctx, pv, p, age);
  };
  const replay = () => {
    cancelAnimationFrame(raf);
    const t0 = performance.now();
    const step = () => {
      const age = Math.floor(((performance.now() - t0) / 1000) * pv.fps);
      paint(age);
      const a = store.preset.animation;
      if (a.type !== 'none' && age <= a.frames + 1) raf = requestAnimationFrame(step);
    };
    step();
  };

  const changed = () => {
    store.setPreset(store.preset); // saves, redraws the player
    paint(1000);
  };

  const render = () => {
    const p = store.preset;
    variant = Math.min(variant, p.styles.length - 1);
    const editable = !p.builtin;

    const sel = h('select', { class: 'input', 'aria-label': 'Style' }, ...store.presets.map((x) => h('option', { value: x.name, selected: x === p }, x.builtin ? `${x.name} (built in)` : x.name)));
    sel.addEventListener('change', () => {
      const x = store.presets.find((y) => y.name === sel.value);
      if (x) {
        variant = 0;
        store.setPreset(x);
        render();
      }
    });

    const top = h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { variant = 0; store.duplicatePreset(p); render(); } }, editable ? 'Duplicate' : 'Duplicate to edit'),
      editable ? h('button', { class: 'btn btn-ghost', onclick: () => { store.deletePreset(p.name); variant = 0; render(); } }, 'Delete') : null,
      h('button', { class: 'btn', onclick: () => void pickAndImportPreset(store).then(render) }, 'Import…'),
      h('button', { class: 'btn', onclick: () => void exportPresetDialog(store, p) }, 'Export…'),
    );

    const parts: (Node | null)[] = [h('div', { class: 'bt-panel-title' }, 'Style'), sel, top];

    if (!editable) {
      parts.push(h('p', { class: 'hint' }, 'The built-in style follows your default font and letter-hole settings. Duplicate it to change colours, sizes or the animation.'));
    } else {
      const name = h('input', { class: 'input', value: p.name, 'aria-label': 'Style name' });
      name.addEventListener('change', () => { store.renamePreset(p, name.value); render(); });
      parts.push(h('label', { class: 'prop style-row' }, h('span', { class: 'prop-l' }, 'Name'), name));

      // Variants: each one is a look that a caption can use (for example another colour for emphasis).
      const vsel = h('select', { class: 'input', 'aria-label': 'Variant' }, ...p.styles.map((s, i) => h('option', { value: String(i), selected: i === variant }, s.name)));
      vsel.addEventListener('change', () => { variant = Number(vsel.value); render(); });
      const vname = h('input', { class: 'input', value: p.styles[variant]!.name, 'aria-label': 'Variant name' });
      vname.addEventListener('change', () => {
        const old = p.styles[variant]!.name;
        const next = vname.value.trim();
        if (!next || next === old || p.styles.some((s) => s.name === next)) return render();
        p.styles[variant]!.name = next;
        store.edit((pr) => pr.captions.forEach((c) => c.style === old && (c.style = next))); // captions keep their look
        changed();
        render();
      });
      const addVariant = h('button', { class: 'btn', onclick: () => {
        const base = structuredClone(p.styles[variant]!) as AssStyle;
        let n = 2;
        while (p.styles.some((s) => s.name === `${base.name} ${n}`)) n++;
        base.name = `${base.name} ${n}`;
        p.styles.push(base);
        variant = p.styles.length - 1;
        changed();
        render();
      } }, 'Add variant');
      const delVariant = h('button', { class: 'btn btn-ghost', disabled: p.styles.length < 2, onclick: () => {
        const gone = p.styles.splice(variant, 1)[0]!;
        const keep = p.styles[0]!.name;
        store.edit((pr) => pr.captions.forEach((c) => c.style === gone.name && (c.style = keep)));
        variant = 0;
        changed();
        render();
      } }, 'Remove variant');
      parts.push(
        h('div', { class: 'bt-panel-title' }, 'Variants'),
        vsel,
        h('label', { class: 'prop style-row' }, h('span', { class: 'prop-l' }, 'Variant name'), vname),
        h('div', { class: 'row' }, addVariant, delVariant),
        styleControls(p.styles[variant]!, { placement: true, fonts: fontNames, onChange: changed }),
        animationControls(p.animation, (a) => { p.animation = a; changed(); replay(); }),
      );
    }

    root.replaceChildren(
      h('div', { class: 'style-side' }, ...parts),
      h('div', { class: 'style-stage' }, canvas, h('button', { class: 'btn', onclick: replay }, 'Replay animation')),
    );
    paint(1000);
  };

  render();
  const dlg = dialog('Caption styles', root, [], 'dlg-wide');
  const observer = new MutationObserver(() => {
    if (!document.body.contains(dlg.el)) {
      cancelAnimationFrame(raf);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
  replay();
}

function animationControls(a: EntranceAnimation, set: (a: EntranceAnimation) => void): HTMLElement {
  const type = h('select', { class: 'input', 'aria-label': 'Entrance' },
    h('option', { value: 'bounce', selected: a.type === 'bounce' }, 'Bounce in'),
    h('option', { value: 'none', selected: a.type === 'none' }, 'None'));
  type.addEventListener('change', () => set(type.value === 'none' ? { type: 'none' } : { type: 'bounce', frames: 6, overshoot: 1.15 }));
  const parts: HTMLElement[] = [h('div', { class: 'bt-panel-title' }, 'Entrance'), h('label', { class: 'prop style-row' }, h('span', { class: 'prop-l' }, 'Animation'), type)];
  if (a.type === 'bounce') {
    const num = (label: string, value: number, min: number, max: number, step: number, apply: (v: number) => EntranceAnimation) => {
      const input = h('input', { type: 'number', class: 'input num', min, max, step, value, 'aria-label': label });
      input.addEventListener('change', () => {
        const v = Number(input.value);
        if (Number.isFinite(v)) set(apply(Math.min(max, Math.max(min, v))));
      });
      return h('label', { class: 'prop style-row' }, h('span', { class: 'prop-l' }, label), input);
    };
    parts.push(
      num('Length (frames)', a.frames, 1, 60, 1, (v) => ({ ...a, frames: Math.round(v) })),
      num('Overshoot', a.overshoot, 1, 3, 0.05, (v) => ({ ...a, overshoot: v })),
    );
  }
  return h('div', {}, ...parts);
}

import { nameOfFile } from '../core/projectFile.ts';
import { FRAME_RATES } from '../core/fps.ts';
import type { Actions } from './actions.ts';
import { dialog, h } from './dom.ts';
import type { Store } from './store.ts';

export const SHAPES: [string, number, number][] = [['Vertical 9:16 (1080×1920)', 1080, 1920], ['Landscape 16:9 (1920×1080)', 1920, 1080], ['Portrait 4:5 (1080×1350)', 1080, 1350], ['Square 1:1 (1080×1080)', 1080, 1080]];

/** File → Project settings: the name (following the file's name until one is typed), the shape and the frame rate of this project. */
export function openProjectSettings(store: Store, actions: Actions): void {
  const p = store.project;
  const name = h('input', { class: 'input', value: p.nameSet ? p.name : '', placeholder: store.fileName ? nameOfFile(store.fileName) : 'Untitled', 'aria-label': 'Project name' });
  const shape = h('select', { class: 'input', 'aria-label': 'Shape' }, ...SHAPES.map(([l, w, hh]) => h('option', { value: `${w}x${hh}`, selected: p.width === w && p.height === hh }, l)), h('option', { value: 'custom', hidden: true, selected: !SHAPES.some(([, w, hh]) => w === p.width && hh === p.height) }, 'Custom size'));
  const rates: number[] = [...new Set<number>([...FRAME_RATES, p.fps])].sort((a, b) => a - b);
  const rate = h('select', { class: 'input', 'aria-label': 'Frame rate' }, ...rates.map((r) => h('option', { value: String(r), selected: r === p.fps }, `${r} frames per second`)));
  const note = h('p', { class: 'hint' }, 'Changing the frame rate keeps every cut, caption and keyframe at the same time in seconds. Video that was filmed at another rate repeats or skips frames to fit.');
  const apply = h('button', { class: 'btn btn-accent' }, 'Apply');
  const field = (label: string, el: HTMLElement) => h('label', { class: 'proj-field' }, h('span', { class: 'prop-l' }, label), el);
  const dlg = dialog('Project settings', h('div', { class: 'stack' },
    field('Name', name),
    h('p', { class: 'hint' }, 'Leave it empty and the project is called what its file is called.'),
    field('Shape', shape), field('Frame rate', rate), note), [h('button', { class: 'btn btn-ghost', onclick: () => dlg.close() }, 'Cancel'), apply]);
  apply.addEventListener('click', () => {
    const next = name.value.trim();
    if (next !== (store.project.nameSet ? store.project.name : '')) actions.setName(next);
    if (shape.value !== 'custom') {
      const [w, hh] = shape.value.split('x').map(Number) as [number, number];
      if (w !== store.project.width || hh !== store.project.height) store.edit((pr) => ((pr.width = w), (pr.height = hh)));
    }
    const fps = Number(rate.value);
    if (fps !== store.project.fps) actions.setFrameRate(fps);
    dlg.close();
  });
}

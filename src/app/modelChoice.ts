import { MODEL_CHOICES, recommendedModel } from '../transcribe/local.ts';
import { dialog, h } from './dom.ts';
import type { Store } from './store.ts';

/**
 * The window shown the first time captions are generated on this device: which speech model to download. The
 * recommendation (accurate on a computer, balanced on a phone) is preselected; the choice is kept, and can be changed
 * later in Settings, Captions. Resolves true when a model was chosen, false when the window was closed.
 */
export function chooseModel(store: Store, touch: boolean): Promise<boolean> {
  const rec = recommendedModel(touch);
  const current = MODEL_CHOICES.some((m) => m.id === store.settings.transcribe.model) ? store.settings.transcribe.model : rec;
  let picked = current;
  const list = h('div', { class: 'stack', role: 'radiogroup', 'aria-label': 'Speech model' });
  for (const m of MODEL_CHOICES) {
    const input = h('input', { type: 'radio', name: 'speech-model', value: m.id, checked: m.id === picked });
    input.addEventListener('change', () => (picked = m.id));
    list.append(h('label', { class: 'setting model-choice' }, input,
      h('span', {}, h('strong', {}, m.name), ` (${m.size})`, m.id === rec ? h('span', { class: 'chip' }, 'recommended') : null, h('small', { class: 'hint' }, m.note))));
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      watch.disconnect();
      dlg.close();
      resolve(ok);
    };
    const use = h('button', { class: 'btn btn-accent', onclick: () => {
      store.updateSettings((s) => ((s.transcribe.model = picked), (s.transcribe.modelChosen = true)));
      finish(true);
    } }, 'Use this model');
    const body = h('div', { class: 'stack' },
      h('p', {}, 'Captions are made on this device by a speech model. It downloads once (the size is shown), then works offline. A bigger model hears more words correctly and times them more closely, and takes longer.'),
      list,
      h('p', { class: 'hint' }, 'You can change this later in Settings, Captions.'));
    const dlg = dialog('Choose a speech model', body, [h('button', { class: 'btn', onclick: () => finish(false) }, 'Cancel'), use]);
    // The window can also be closed with × or by pressing outside it.
    const watch = new MutationObserver(() => dlg.el.isConnected || finish(false));
    watch.observe(document.body, { childList: true });
  });
}

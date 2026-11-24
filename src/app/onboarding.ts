import { MODEL_CHOICES, recommendedModel, sharedTranscriber } from '../transcribe/local.ts';
import { applyChosen, previewConfig, readConfig, CONFIG_EXT } from './config.ts';
import { dialog, h } from './dom.ts';
import { platform, pickFiles } from './platform.ts';
import { shareApi } from './share.ts';
import type { Store } from './store.ts';

/**
 * The first-run setup: a few short steps, each skippable, shown once. Step one asks whether there is a config file; picking one applies it and
 * ends the setup (everything it asks for is in the file). Otherwise: the speech model for captions (downloaded now, if wanted), then this device's
 * name and linking it with another TurboCut. Settings, Config and Settings, Captions have all of it again later.
 */
export function startOnboarding(store: Store, openDevices: () => void): Promise<void> {
  return new Promise((resolve) => {
    const touch = matchMedia('(pointer: coarse)').matches;
    let step = 0;
    let finished = false;
    let abort: AbortController | null = null;
    let model = MODEL_CHOICES.some((m) => m.id === store.settings.transcribe.model) ? store.settings.transcribe.model : recommendedModel(touch);
    const body = h('div', { class: 'stack onboarding' });
    const foot = h('div', { class: 'row onboarding-foot' });
    const done = () => {
      if (finished) return;
      finished = true;
      abort?.abort();
      watch.disconnect();
      store.updateSettings({ onboarded: true });
      dlg.close();
      resolve();
    };
    const dlg = dialog('Welcome to TurboCut', h('div', { class: 'stack' }, body, foot), [], 'dlg-onboarding');
    const watch = new MutationObserver(() => dlg.el.isConnected || done()); // closing the window with × skips the rest
    watch.observe(document.body, { childList: true });

    const go = (n: number) => ((step = n), draw());
    const btn = (label: string, run: () => void, cls = 'btn') => h('button', { class: cls, type: 'button', onclick: run }, label);
    const dots = () => h('p', { class: 'hint onboarding-dots', 'aria-label': `Step ${step + 1} of 3` }, `Step ${step + 1} of 3`);

    // ---- 1: a config file?
    const stepConfig = () => {
      const note = h('p', { class: 'hint' });
      body.replaceChildren(dots(),
        h('p', {}, 'Do you have a TurboCut config file from another device? It carries your settings, layouts, shortcuts and look, and setting up from it skips the rest of this.'),
        note);
      foot.replaceChildren(
        btn('Choose a config file…', async () => {
          const [f] = await pickFiles(`${CONFIG_EXT},.json,application/json`);
          if (!f) return;
          try {
            const { next, changes } = previewConfig(store.settings, readConfig(await f.text()));
            const picked = new Set(changes.map((c) => c.entry.path));
            store.updateSettings(() => Object.assign(store.settings, applyChosen(store.settings, next, picked)));
            store.say(`Applied ${picked.size} setting${picked.size === 1 ? '' : 's'} from ${f.name}.`);
            done();
          } catch (e) {
            note.textContent = e instanceof Error ? e.message : String(e);
          }
        }, 'btn btn-accent'),
        btn('No, set up from scratch', () => go(1)),
        btn('Skip setup', done, 'btn btn-ghost'));
    };

    // ---- 2: the speech model
    const stepModel = () => {
      const bar = h('progress', { class: 'prog', max: 1, value: 0, style: { display: 'none' } });
      const note = h('p', { class: 'hint' });
      const list = h('div', { class: 'stack', role: 'radiogroup', 'aria-label': 'Speech model' }, ...MODEL_CHOICES.map((m) => {
        const input = h('input', { type: 'radio', name: 'onboard-model', checked: m.id === model, onchange: () => (model = m.id) });
        return h('label', { class: 'setting model-choice' }, input, h('span', {}, h('strong', {}, m.name), ` (${m.size})`, m.id === recommendedModel(touch) ? h('span', { class: 'chip' }, 'recommended') : null, h('small', { class: 'hint' }, m.note)));
      }));
      body.replaceChildren(dots(), h('p', {}, 'Captions are made on this device by a speech model. Pick one; it downloads once and then works offline. Your audio never leaves the device.'), list, bar, note);
      const dl = btn('Download it now', async () => {
        store.updateSettings((s) => ((s.transcribe.model = model), (s.transcribe.modelChosen = true)));
        abort = new AbortController();
        dl.disabled = true;
        bar.style.display = '';
        note.textContent = 'Downloading…';
        try {
          await sharedTranscriber(model, store.settings.transcribe.compute).preload((f) => ((bar.value = f), (note.textContent = `Downloading… ${Math.round(f * 100)}%`)), abort.signal);
          go(2);
        } catch (e) {
          if (abort?.signal.aborted) return;
          dl.disabled = false;
          bar.style.display = 'none';
          note.textContent = `Could not download it: ${e instanceof Error ? e.message : e}. You can try again, or choose Later: it downloads when you first make captions.`;
        }
      }, 'btn btn-accent');
      foot.replaceChildren(dl,
        btn('Choose it, download later', () => (store.updateSettings((s) => ((s.transcribe.model = model), (s.transcribe.modelChosen = true))), go(2))),
        btn('Skip', () => go(2), 'btn btn-ghost'));
    };

    // ---- 3: this device, and other devices
    const stepDevices = () => {
      const name = h('input', { class: 'input', value: store.settings.deviceName, placeholder: platform === 'android' ? 'Android phone' : 'This device\'s own name', 'aria-label': 'Device name', maxlength: 60 });
      name.addEventListener('change', () => store.updateSettings({ deviceName: name.value.trim() }));
      body.replaceChildren(dots(),
        h('p', {}, shareApi ? 'Other TurboCut apps on your network can find this computer and send you projects (you accept each one), and you can send projects to them. A phone links up the first time with a link from the computer, then it just asks Yes or No.' : 'Link this device with a computer running TurboCut: on the computer open File, Send to another device, Get a link, then paste it here. After the first time it asks you Yes or No when the computer sends something.'),
        h('label', { class: 'setting col' }, h('span', { class: 'prop-l' }, 'Name shown to your other devices'), name));
      foot.replaceChildren(
        btn(shareApi ? 'Done' : 'Link with a computer…', () => (name.dispatchEvent(new Event('change')), shareApi ? done() : (done(), openDevices())), 'btn btn-accent'),
        ...(shareApi ? [] : [btn('Not now', () => (name.dispatchEvent(new Event('change')), done()), 'btn btn-ghost')]));
    };
    const draw = () => [stepConfig, stepModel, stepDevices][step]!();
    draw();
  });
}

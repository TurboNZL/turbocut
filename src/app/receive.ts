import type { Actions } from './actions.ts';
import { dialog, h } from './dom.ts';
import { importFont } from './fonts.ts';
import { importPresetFile } from './presetIO.ts';
import { cleanCode, pullShelf, type Pulled } from './pull.ts';
import type { Store } from './store.ts';

const LAST = 'turbocut.lastSender';
const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 10485760 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Open what another TurboCut sent, whichever way it arrived (pushed to this app, or fetched with a code): fonts, caption style, then the project. */
export async function applyReceived(store: Store, actions: Actions, r: Pick<Pulled, 'from' | 'project' | 'preset' | 'media' | 'fonts'>): Promise<boolean> {
  try {
    for (const f of r.fonts) await importFont(f).catch(() => []);
    if (r.preset) await importPresetFile(store, new File([r.preset], 'received.turbocut-preset.json', { type: 'application/json' }));
    return await actions.openReceived(r.project, r.media, r.from);
  } catch (e) {
    store.say(`Could not open what ${r.from} sent: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

const remembered = (): string => {
  try {
    return localStorage.getItem(LAST) ?? '';
  } catch {
    return '';
  }
};

/**
 * "Receive from a computer": for devices that cannot be found on the network by themselves (a phone). The computer shows its address and a
 * six-digit code (File → Send to another device… → Send with a code); typing them here brings the project, fonts and media across. Twitch
 * clips come as links and download on this device. The address is remembered, so the next time only the code is needed.
 */
export function openReceiveDialog(store: Store, actions: Actions): void {
  const address = h('input', { class: 'input', type: 'text', inputmode: 'decimal', placeholder: '192.168.1.20', 'aria-label': 'Address of the computer', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, value: remembered() });
  const code = h('input', { class: 'input code-input', type: 'text', inputmode: 'numeric', placeholder: '000000', maxlength: 7, 'aria-label': 'Code', autocomplete: 'one-time-code' });
  const note = h('p', { class: 'hint' }, 'On the computer: File → Send to another device… → Send with a code. It shows the address and the code. Both devices need to be on the same Wi-Fi.');
  const progress = h('progress', { class: 'prog', max: 1, value: 0, style: { display: 'none' } });
  const go = h('button', { class: 'btn btn-accent' }, 'Receive');
  const cancel = h('button', { class: 'btn btn-ghost' }, 'Cancel');
  const dlg = dialog('Receive from a computer', h('div', { class: 'stack' },
    h('label', { class: 'setting col' }, h('span', { class: 'prop-l' }, 'Address of the computer'), address),
    h('label', { class: 'setting col' }, h('span', { class: 'prop-l' }, 'Code'), code), note, progress), [cancel, go]);
  let abort: AbortController | null = null;
  const watch = new MutationObserver(() => dlg.el.isConnected || (watch.disconnect(), abort?.abort()));
  watch.observe(document.body, { childList: true });
  cancel.addEventListener('click', () => (abort?.abort(), dlg.close()));
  code.addEventListener('input', () => {
    const c = cleanCode(code.value);
    code.value = c.length > 3 ? `${c.slice(0, 3)} ${c.slice(3)}` : c;
  });
  const run = async () => {
    if (abort) return;
    abort = new AbortController();
    go.disabled = address.disabled = code.disabled = true;
    progress.style.display = '';
    progress.removeAttribute('value');
    note.textContent = 'Connecting…';
    try {
      const got = await pullShelf(address.value, code.value, {
        signal: abort.signal,
        onProgress: (d, t, label) => {
          progress.max = t || 1;
          progress.value = d;
          note.textContent = `Receiving ${label}… ${mb(d)} of ${mb(t)}`;
        },
      });
      try {
        localStorage.setItem(LAST, address.value.trim());
      } catch {
        /* storage blocked: the address just is not remembered */
      }
      watch.disconnect();
      dlg.close();
      store.say(`Received from ${got.from}.`);
      await applyReceived(store, actions, got);
    } catch (e) {
      if (abort?.signal.aborted) return;
      note.textContent = e instanceof Error ? e.message : String(e);
      progress.style.display = 'none';
      go.disabled = address.disabled = code.disabled = false;
      abort = null;
    }
  };
  go.addEventListener('click', () => void run());
  code.addEventListener('keydown', (e) => e.key === 'Enter' && void run());
  queueMicrotask(() => (address.value ? code : address).focus());
}

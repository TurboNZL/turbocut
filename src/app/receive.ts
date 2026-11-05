import type { Actions } from './actions.ts';
import { dialog, h } from './dom.ts';
import { importFont } from './fonts.ts';
import { importPresetFile } from './presetIO.ts';
import { platform } from './platform.ts';
import { checkInbox, parseLink, pullShelf, pullToken, type Pulled } from './pull.ts';
import { deviceKey, forgetComputer, knownComputers, rememberComputer } from './pairing.ts';
import type { Store } from './store.ts';

const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 10485760 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Open what another TurboCut sent, whichever way it arrived (pushed to this app, or fetched from a link): fonts, caption style, then the project. */
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

/**
 * "Receive from a computer": for devices that cannot be found on the network by themselves (a phone). The first time, the computer shows a link
 * (File → Send to another device… → Get a link for a phone); pasting it here brings the project, fonts and media across. After that first
 * transfer this device remembers the computer: opening this window looks for it by itself, and a project the computer puts up for this device
 * (Send, next to the device's name) starts arriving as soon as it is ready. A link on the clipboard is still offered at once.
 */
export function openReceiveDialog(store: Store, actions: Actions): void {
  const link = h('input', { class: 'input', type: 'text', inputmode: 'url', placeholder: 'http://192.168.1.20:47903/shelf/…', 'aria-label': 'Link from the computer', autocomplete: 'off', autocapitalize: 'off', spellcheck: false }) as HTMLInputElement;
  const note = h('p', { class: 'hint' }, 'On the computer: File → Send to another device… → Get a link for a phone. Copy the link, paste it here. Both devices need to be on the same Wi-Fi.');
  const progress = h('progress', { class: 'prog', max: 1, value: 0, style: { display: 'none' } });
  const go = h('button', { class: 'btn btn-accent' }, 'Receive');
  const paste = h('button', { class: 'btn', type: 'button' }, 'Paste');
  const cancel = h('button', { class: 'btn btn-ghost' }, 'Cancel');
  const known = h('div', { class: 'share-found receive-known', role: 'list' });
  const status = new Map<string, string>();
  const dlg = dialog('Receive from a computer', h('div', { class: 'stack' },
    known,
    h('label', { class: 'setting col' }, h('span', { class: 'prop-l' }, 'Link from the computer'), h('div', { class: 'share-link-row' }, link, paste)), note, progress), [cancel, go]);
  let abort: AbortController | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const closed = () => !dlg.el.isConnected;
  const watch = new MutationObserver(() => closed() && (watch.disconnect(), clearTimeout(pollTimer), abort?.abort()));
  watch.observe(document.body, { childList: true });
  cancel.addEventListener('click', () => (clearTimeout(pollTimer), abort?.abort(), dlg.close()));

  /** Who this device says it is when a transfer ends, so the computer can remember it too. */
  const identity = () => ({ key: deviceKey(), name: store.settings.deviceName.trim() || (platform === 'android' ? 'Android phone' : 'TurboCut device') });

  const lockUi = (on: boolean) => (go.disabled = link.disabled = paste.disabled = on);
  /** Fetch from wherever `fetchAll` points, show progress, open the result, and remember the computer for next time. */
  const receive = async (fetchAll: (o: Parameters<typeof pullShelf>[1]) => Promise<Pulled>) => {
    if (abort) return;
    abort = new AbortController();
    clearTimeout(pollTimer);
    lockUi(true);
    progress.style.display = '';
    progress.removeAttribute('value');
    note.textContent = 'Connecting…';
    try {
      const got = await fetchAll({
        signal: abort.signal,
        identity: identity(),
        onProgress: (d, t, label) => {
          progress.max = t || 1;
          progress.value = d;
          note.textContent = `Receiving ${label}… ${mb(d)} of ${mb(t)}`;
        },
      });
      rememberComputer(got.base, got.from);
      watch.disconnect();
      dlg.close();
      store.say(`Received from ${got.from}.`);
      await applyReceived(store, actions, got);
    } catch (e) {
      if (abort?.signal.aborted) return;
      note.textContent = e instanceof Error ? e.message : String(e);
      progress.style.display = 'none';
      lockUi(false);
      abort = null;
      drawKnown();
      startPolling();
    }
  };
  const run = () => receive((o) => pullShelf(link.value, o));

  // ---- computers this device has fetched from before: look for what each has waiting
  const drawKnown = () => {
    const list = knownComputers();
    known.hidden = list.length === 0;
    known.replaceChildren(
      ...(list.length ? [h('p', { class: 'hint' }, 'Computers you have received from. Press Send next to this device\'s name in TurboCut on the computer, and it starts here by itself.')] : []),
      ...list.map((c) => h('div', { class: 'share-device', role: 'listitem', 'data-computer': c.base },
        h('div', {}, h('strong', {}, c.name), h('small', { class: 'hint' }, ` ${status.get(c.base) ?? 'Looking…'}`)),
        h('button', { class: 'btn btn-ghost', 'aria-label': `Forget ${c.name}`, onclick: () => (forgetComputer(c.base), drawKnown()) }, 'Forget'))),
    );
  };
  const startPolling = () => {
    clearTimeout(pollTimer);
    const tick = async () => {
      if (closed() || abort) return;
      const list = knownComputers();
      for (const c of list) {
        try {
          const w = await checkInbox(c.base, deviceKey(), { signal: AbortSignal.timeout(2500) });
          if (closed() || abort) return;
          status.set(c.base, w ? `${w.project} is ready` : 'nothing waiting');
          if (w) return void receive((o) => pullToken(c.base, w.token, o));
        } catch {
          status.set(c.base, 'not reachable now (same Wi-Fi? app open on the computer?)');
        }
      }
      drawKnown();
      pollTimer = setTimeout(() => void tick(), 2000);
    };
    if (knownComputers().length) void tick();
  };
  drawKnown();
  startPolling();

  /** Take a link from the clipboard when there is one (the browser may ask first, or refuse: then the person pastes by hand). */
  const fromClipboard = async (auto: boolean) => {
    try {
      const text = await navigator.clipboard.readText();
      if (parseLink(text)) {
        link.value = text.trim();
        if (auto) note.textContent = 'The link on your clipboard is filled in. Press Receive.';
      } else if (!auto) note.textContent = 'There is no TurboCut link on the clipboard. Copy it on the computer first.';
    } catch {
      if (!auto) note.textContent = 'This device did not allow reading the clipboard. Press and hold in the box and choose Paste.';
    }
  };
  paste.addEventListener('click', () => void fromClipboard(false));
  go.addEventListener('click', () => void run());
  link.addEventListener('keydown', (e) => e.key === 'Enter' && void run());
  link.addEventListener('paste', () => setTimeout(() => parseLink(link.value) && (note.textContent = 'Press Receive.'), 0));
  queueMicrotask(() => link.focus());
  if (platform !== 'web') void fromClipboard(true); // a browser would ask permission just for opening the window
}

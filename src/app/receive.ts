import type { Actions } from './actions.ts';
import { dialog, h } from './dom.ts';
import { importFont } from './fonts.ts';
import { importPresetFile } from './presetIO.ts';
import { platform } from './platform.ts';
import { keepReceived } from './projectLibrary.ts';
import { checkInbox, parseLink, pullShelf, pullToken, pushToComputer, type Pulled } from './pull.ts';
import { deviceKey, forgetComputer, knownComputers, rememberComputer } from './pairing.ts';
import type { Store } from './store.ts';

const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 10485760 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Open what another TurboCut sent, whichever way it arrived (pushed to this app, or fetched from a link): a project file, or (from an older app) fonts, caption style, then the project. */
export async function applyReceived(store: Store, actions: Actions, r: Pick<Pulled, 'from' | 'project' | 'preset' | 'media' | 'fonts'> & { bundle?: File | null }): Promise<boolean> {
  try {
    // A whole project file: keep it in the projects folder (so it is there next time, in the project manager) and open it from there.
    if (r.bundle) {
      const ref = await keepReceived(r.bundle, r.bundle.name, store.settings.saveIn);
      store.say(`Received ${r.bundle.name.replace(/\.turbocut[cf]?$/i, '')} from ${r.from}. It is in Projects.`);
      return await actions.openFromRef(ref);
    }
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
 * (File → Send to another device… → Get a link for a phone); pasting it here brings the project file (with its videos, fonts and caption style inside) across and keeps it in Projects. After that first
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
  const sendBox = h('div', { class: 'share-found receive-send', role: 'list' });
  const dlg = dialog('Send or receive', h('div', { class: 'stack' },
    sendBox,
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
  /** Send the open project to a computer this device has fetched from (it asks its person to accept; nothing to paste). */
  const sendTo = async (c: { base: string; name: string }) => {
    if (abort) return;
    if (!(await actions.ensureName('The computer files it under this name.'))) return;
    abort = new AbortController();
    clearTimeout(pollTimer);
    lockUi(true);
    progress.style.display = '';
    progress.removeAttribute('value');
    try {
      note.textContent = 'Packing the project…';
      const b = await actions.makeBundle();
      const id = identity();
      await pushToComputer(c.base, { id: await shortHash(id.key), name: id.name }, b.file, { project: store.project.name, media: b.media, fonts: b.fonts }, {
        signal: abort.signal,
        onStage: (s) => (note.textContent = s === 'waiting' ? `Waiting for ${c.name} to accept…` : `Sending to ${c.name}…`),
      });
      watch.disconnect();
      dlg.close();
      store.say(`Sent "${store.project.name}" to ${c.name}.`);
    } catch (e) {
      if (abort?.signal.aborted) return;
      note.textContent = e instanceof Error ? e.message : String(e);
      progress.style.display = 'none';
      lockUi(false);
      abort = null;
      startPolling();
    }
  };
  const drawKnown = () => {
    const list = knownComputers();
    sendBox.hidden = list.length === 0 || store.project.tracks.every((t) => t.clips.length === 0);
    sendBox.replaceChildren(
      ...(sendBox.hidden ? [] : [h('p', { class: 'hint' }, `Send "${store.project.name}" to a computer. It asks to accept first, and keeps the project in its Projects.`)]),
      ...list.map((c) => h('div', { class: 'share-device', role: 'listitem', 'data-send': c.base }, h('div', {}, h('strong', {}, c.name)), h('button', { class: 'btn btn-accent', type: 'button', onclick: () => void sendTo(c) }, 'Send'))),
    );
    known.hidden = list.length === 0;
    known.replaceChildren(
      ...(list.length ? [h('p', { class: 'hint' }, 'Computers you have received from. When one sends you a project, this phone asks whether to keep it, even with this window closed.')] : []),
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

/** A short, stable name for this device's key: the computer sees it instead of the key. */
async function shortHash(key: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/**
 * Phones and browsers cannot be found by a computer, so they look instead: while the app is open and showing, every few seconds each computer this
 * device has received from is asked whether it has something waiting. When it does, a small window asks "Save it to your projects?" and one tap
 * on Yes brings it across. Nothing is downloaded before that tap. A project that was declined is not asked about again until the app restarts.
 */
export function startInboxWatch(store: Store, actions: Actions): void {
  if (platform === 'electron') return; // a computer is found directly and shows its own Accept
  const declined = new Set<string>();
  let asking = false;
  const tick = async () => {
    if (asking || document.hidden || document.querySelector('.dlg-backdrop')) return;
    for (const c of knownComputers()) {
      try {
        const w = await checkInbox(c.base, deviceKey(), { signal: AbortSignal.timeout(2500) });
        if (!w || declined.has(w.token)) continue;
        asking = true;
        const yes = await new Promise<boolean>((resolve) => {
          let done = false;
          const finish = (v: boolean) => {
            if (done) return;
            done = true;
            seen.disconnect();
            d.close();
            resolve(v);
          };
          const d = dialog('Incoming project', h('p', {}, h('strong', {}, w.from), ' sent you ', h('strong', {}, `"${w.project}"`), '. Save it to your projects?'), [
            h('button', { class: 'btn btn-accent', onclick: () => finish(true) }, 'Yes, save it'),
            h('button', { class: 'btn', onclick: () => finish(false) }, 'No'),
          ]);
          const seen = new MutationObserver(() => d.el.isConnected || finish(false));
          seen.observe(document.body, { childList: true });
        });
        if (!yes) {
          declined.add(w.token);
          asking = false;
          continue;
        }
        store.say(`Receiving ${w.project} from ${w.from}…`);
        try {
          const got = await pullToken(c.base, w.token, { identity: { key: deviceKey(), name: store.settings.deviceName.trim() || (platform === 'android' ? 'Android phone' : 'TurboCut device') } });
          rememberComputer(got.base, got.from);
          await applyReceived(store, actions, got);
        } catch (e) {
          store.say(`Could not receive it: ${e instanceof Error ? e.message : e}`);
        }
        asking = false;
        return;
      } catch {
        /* not reachable right now (another network, the app is closed there): try again next time */
      }
    }
    asking = false;
  };
  setInterval(() => void tick(), 5000);
}

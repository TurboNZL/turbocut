import type { Asset } from '../core/types.ts';
import type { Store } from './store.ts';
import { dialog, h } from './dom.ts';
import { openWithConversion } from './transcode.ts';
import { fetchTwitchClip } from './twitchDialog.ts';

/** The media of a loaded project that has a link to fetch it from and is not open yet. */
export const restorable = (store: Store): Asset[] => store.missingAssets().filter((a) => a.source);

/**
 * Download the clip behind one missing media entry and open it as that entry. The best version of a Twitch clip can be one this
 * device cannot decode (HEVC), so each version down is tried until one opens; the desktop app converts the file first when it can.
 * Throws a sentence when none works. The entry keeps its own name and length: it is the same clip.
 */
export async function restoreAsset(store: Store, a: Asset, note: (m: string) => void, signal?: AbortSignal): Promise<void> {
  if (!a.source) throw new Error(`${a.name} has no link to download it from.`);
  const tried: string[] = [];
  for (let rank = 0; ; rank++) {
    const { file, count } = await fetchTwitchClip(a.source.url, (f) => note(f == null ? `Asking Twitch for ${a.name}…` : `Downloading ${a.name}${rank ? ' (a smaller version)' : ''}… ${Math.round(f * 100)}%`), signal, rank);
    try {
      const dims = await openWithConversion(file, (f) => store.lib.relink(a.id, f, a.name, true), note, signal);
      if (a.hasVideo && dims.width && dims.height) (a.width = dims.width), (a.height = dims.height);
      return;
    } catch (e) {
      if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw e;
      tried.push(`version ${rank + 1} of ${count}: ${e instanceof Error ? e.message.replace(/^the picture of .*? \(/, '(').replace(/, although its sound and length read fine$/, '') : String(e)}`);
      if (rank + 1 >= count) throw new Error(`None of the ${count} versions Twitch has of ${a.name} can be opened on this device. ${tried.join(' | ')}`);
      note(`Version ${rank + 1} of ${count} of ${a.name} could not be decoded here. Trying the next one down…`);
    }
  }
}

/** A window that downloads every missing entry that has a link, one after the other, and closes itself when done. Resolves how many came back. */
export function restoreDialog(store: Store): Promise<number> {
  const list = restorable(store);
  if (!list.length) return Promise.resolve(0);
  const note = h('p', { class: 'hint' }, 'Starting…');
  const progress = h('progress', { class: 'prog', max: 1, value: 0 });
  const errors = h('ul', { class: 'relink-list' });
  const cancel = h('button', { class: 'btn btn-ghost' }, 'Cancel');
  const dlg = dialog(`Downloading ${list.length === 1 ? 'a Twitch clip' : `${list.length} Twitch clips`}`, h('div', { class: 'stack' },
    h('p', {}, 'The project came with links to its Twitch clips instead of the video files. TurboCut downloads them here.'), progress, note, errors), [cancel]);
  const abort = new AbortController();
  const gone = new MutationObserver(() => dlg.el.isConnected || (gone.disconnect(), abort.abort()));
  gone.observe(document.body, { childList: true });
  cancel.addEventListener('click', () => (abort.abort(), dlg.close()));
  return (async () => {
    let n = 0;
    for (const [i, a] of list.entries()) {
      try {
        progress.removeAttribute('value');
        await restoreAsset(store, a, (m) => (note.textContent = `${list.length > 1 ? `(${i + 1} of ${list.length}) ` : ''}${m}`), abort.signal);
        n++;
      } catch (e) {
        if (abort.signal.aborted) break;
        errors.append(h('li', {}, e instanceof Error ? e.message : String(e)));
      }
      progress.value = (i + 1) / list.length;
    }
    gone.disconnect();
    store.emit('project');
    if (!errors.childElementCount) dlg.close();
    else {
      note.textContent = n ? `${n} of ${list.length} came back. The rest need their files:` : 'Nothing could be downloaded:';
      cancel.replaceWith(h('button', { class: 'btn', onclick: () => dlg.close() }, 'Close'));
      // Stay until the person has read what failed; whatever opens next (the list of files to find) comes after.
      await new Promise<void>((resolve) => {
        const closed = new MutationObserver(() => dlg.el.isConnected || (closed.disconnect(), resolve()));
        closed.observe(document.body, { childList: true });
      });
    }
    return n;
  })();
}

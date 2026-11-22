import type { Actions } from './actions.ts';
import { askText, dialog, h } from './dom.ts';
import { icon } from './icons.ts';
import { platform } from './platform.ts';
import * as lib from './projectLibrary.ts';
import type { ProjectRef } from './projectFiles.ts';
import { ago } from './recent.ts';
import type { Store } from './store.ts';

const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 10485760 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
/** Whether two references are the same file (a path, or a browser handle, which has to be asked). */
const sameFile = async (a: ProjectRef, b: ProjectRef): Promise<boolean> =>
  a.kind === 'path' ? b.kind === 'path' && a.path === b.path : b.kind === 'handle' && (await a.handle.isSameEntry(b.handle).catch(() => false));

const KIND: Record<string, string> = { full: 'Full project', edit: 'Edit only', clips: 'With its clips' };

/**
 * The project manager: every project TurboCut keeps in its project folders, with where new projects go. The default folder is TurboCut's own
 * (app data on a computer, app storage on a phone). On a computer the person can add folders of their own (Documents, a synced folder) that
 * are read too, and choose which one new projects are saved in. `onOpened` runs after a project was opened from here (the home screen closes).
 */
export function openProjectManager(store: Store, actions: Actions, onOpened?: () => void): { close: () => void } {
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search projects', 'aria-label': 'Search projects' }) as HTMLInputElement;
  const rows = h('div', { class: 'pm-rows', role: 'list' });
  const folderBox = h('div', { class: 'pm-folders' });
  const note = h('p', { class: 'hint' });
  let entries: lib.LibEntry[] = [];
  let busy = false;

  const openFile = h('button', { class: 'btn', onclick: async () => ((await actions.openProject()) && done()) }, icon('folder', 16), 'Open a file…');
  // only where folders can be added (a computer): a `hidden` button would still show, `.btn` sets its own display
  const addFolder = lib.canAddFolders() ? h('button', { class: 'btn', onclick: async () => ((await lib.addFolder()) && (await refresh())) }, icon('folderPlus', 16), 'Add a folder…') : null;
  const dlg = dialog('Projects', h('div', { class: 'stack pm' },
    h('div', { class: 'pm-bar' }, ...([search, openFile, addFolder].filter(Boolean) as HTMLElement[])),
    rows, note, folderBox), [h('button', { class: 'btn', onclick: () => dlg.close() }, 'Close')], 'pm-dlg');
  const done = () => (dlg.close(), onOpened?.());

  const open = async (e: lib.LibEntry) => {
    if (busy) return;
    busy = true;
    try {
      if (await actions.openFromRef(e.ref)) done();
    } finally {
      busy = false;
    }
  };

  const confirmDelete = (e: lib.LibEntry) =>
    new Promise<boolean>((resolve) => {
      let answered = false;
      const finish = (v: boolean) => {
        if (answered) return;
        answered = true;
        watch.disconnect();
        d.close();
        resolve(v);
      };
      const bin = lib.canReveal() ? 'It goes to the bin, so it can be put back.' : 'It is deleted for good.';
      const d = dialog('Delete this project?', h('div', { class: 'stack' }, h('p', {}, h('strong', {}, e.name)), h('p', { class: 'hint' }, `${bin} Videos the project used stay where they are.`)), [
        h('button', { class: 'btn', onclick: () => finish(false) }, 'Cancel'),
        h('button', { class: 'btn btn-accent', onclick: () => finish(true) }, 'Delete'),
      ]);
      const watch = new MutationObserver(() => d.el.isConnected || finish(false));
      watch.observe(document.body, { childList: true });
    });

  const act = async (what: () => Promise<unknown>, fail: string) => {
    try {
      await what();
      note.textContent = '';
    } catch (err) {
      note.textContent = `${fail}: ${err instanceof Error ? err.message : err}`;
    }
    await refresh();
  };

  const drawRows = () => {
    const q = search.value.trim().toLowerCase();
    const shown = entries.filter((e) => !q || e.name.toLowerCase().includes(q));
    rows.replaceChildren(
      ...(shown.length
        ? shown.map((e) =>
            h('div', { class: 'pm-row', role: 'listitem', 'data-name': e.name },
              h('button', { class: 'pm-open', type: 'button', title: `Open ${e.name}`, onclick: () => void open(e) },
                h('span', { class: 'pm-ico' }, icon('file', 18)),
                h('span', { class: 'pm-text' },
                  h('strong', {}, e.name.replace(/\.turbocut[cf]?$/i, '')),
                  h('small', {}, `${KIND[e.format]} · ${mb(e.size)}${e.modified ? ` · ${ago(e.modified)}` : ''} · ${e.folderLabel}`))),
              h('div', { class: 'pm-acts' },
                ...(lib.canReveal() ? [h('button', { class: 'btn btn-ghost icon-btn', type: 'button', 'aria-label': `Show ${e.name} in its folder`, title: 'Show in folder', onclick: () => void lib.reveal(e) }, icon('folder', 16))] : []),
                h('button', { class: 'btn btn-ghost icon-btn', type: 'button', 'aria-label': `Rename ${e.name}`, title: 'Rename', onclick: async () => {
                  const n = await askText('Rename project', e.name.replace(/\.turbocut[cf]?$/i, ''), 'Name', 'Rename');
                  if (n && n.trim()) await act(async () => {
                    const was = store.fileRef;
                    const open = !!was && (await sameFile(was, e.ref));
                    const ref = await lib.rename(e, n);
                    // the open project follows its file: Save keeps writing to the renamed one
                    if (open) {
                      store.fileRef = ref;
                      store.fileName = ref.kind === 'path' ? ref.path.split(/[\\/]/).pop() ?? store.fileName : ref.handle.name;
                      store.emit('saved');
                    }
                  }, 'Could not rename');
                } }, icon('pencil', 16)),
                h('button', { class: 'btn btn-ghost icon-btn', type: 'button', 'aria-label': `Delete ${e.name}`, title: 'Delete', onclick: async () => {
                  if (await confirmDelete(e)) await act(() => lib.remove(e), 'Could not delete');
                } }, icon('trash', 16))),
            ),
          )
        : [h('p', { class: 'hint pm-empty' }, entries.length ? 'No project matches that.' : 'No projects here yet. Save a project and it shows up in this list. A project another device sends arrives here too.')]),
    );
  };

  const drawFolders = async () => {
    const { list: dirs, saveIn } = await lib.folders();
    // The place new projects go: the shell remembers it on a computer, the settings on a phone.
    const current = platform === 'android' ? (store.settings.saveIn === 'personal' ? dirs.find((d) => d.kind === 'personal')?.path : dirs[0]?.path) : saveIn;
    const choose = async (d: lib.LibFolder) => {
      if (platform === 'android') store.updateSettings({ saveIn: d.kind === 'personal' ? 'personal' : 'app' });
      else await lib.setSaveFolder(d.kind === 'default' ? null : d.path);
      await drawFolders();
    };
    const selectable = dirs.length > 1;
    folderBox.replaceChildren(
      h('h3', { class: 'pm-h' }, 'Folders'),
      h('p', { class: 'hint' }, lib.canAddFolders()
        ? 'TurboCut reads the projects in these folders. New projects are saved in the one that is marked. Add your own folder to keep projects with your other files.'
        : platform === 'android'
          ? 'App storage is private to TurboCut. Documents/TurboCut is a normal folder you can reach from other apps and from a computer. New projects are saved in the one that is marked.'
          : 'This browser keeps the projects it receives here. Files you save with the Save dialog live wherever you put them.'),
      ...dirs.map((d) =>
        h('div', { class: `pm-folder${d.exists ? '' : ' gone'}`, role: 'listitem', 'data-folder': d.path },
          selectable
            ? h('label', { class: 'pm-pick', title: 'New projects are saved here' },
                Object.assign(h('input', { type: 'radio', name: 'pm-save', 'aria-label': `Save new projects in ${d.label}` }), { checked: d.path === current, onchange: () => void choose(d) }),
                h('span', {}, h('strong', {}, d.label), h('small', {}, platform === 'android' || !lib.canAddFolders() ? '' : d.path), ...(d.exists ? [] : [h('small', { class: 'bad' }, 'Not found. Connect the drive or remove this folder.')])))
            : h('div', { class: 'pm-pick' }, h('span', {}, h('strong', {}, d.label), h('small', {}, lib.canAddFolders() ? d.path : ''))),
          d.kind === 'personal' && lib.canAddFolders()
            ? h('button', { class: 'btn btn-ghost icon-btn', type: 'button', 'aria-label': `Stop reading ${d.label}`, title: 'Stop reading this folder (its files stay)', onclick: async () => (await lib.removeFolder(d.path), await refresh()) }, icon('close', 16))
            : h('span')),
      ),
    );
  };

  const refresh = async () => {
    try {
      entries = await lib.list();
    } catch (err) {
      entries = [];
      note.textContent = `Could not read the project folders: ${err instanceof Error ? err.message : err}`;
    }
    drawRows();
    await drawFolders();
  };
  search.addEventListener('input', drawRows);
  void refresh();
  queueMicrotask(() => search.focus());
  return { close: () => dlg.close() };
}

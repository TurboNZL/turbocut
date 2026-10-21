import { guides, openGuides } from './guides.ts';
import { h } from './dom.ts';
import { icon, type IconName } from './icons.ts';
import { platform } from './platform.ts';
import { ago, forgetRecent, listRecent, type RecentEntry } from './recent.ts';
import type { Store } from './store.ts';
import { checkForUpdate, type LatestRelease, type ReleaseAsset } from './updater.ts';
import { APP_VERSION } from './version.ts';

const RELEASES = 'https://github.com/TurboNZL/turbocut/releases';

export interface HomeDeps {
  store: Store;
  /** Pick video files and put them in the bin. Resolves true when files were chosen. */
  importFiles: () => Promise<boolean>;
  /** Pick a `.turbocut` project file and open it. Resolves true only when one was opened. */
  openProject: () => Promise<boolean>;
  /** Open one of the recent projects. Resolves true when it was opened. */
  openRecent: (key: string) => Promise<boolean>;
  openSettings: (tab?: 'Updates' | 'Layout' | 'Fonts') => void;
  /** The bottom dock is on: the home screen leaves room for it and is a page, not a layer to dismiss. */
  docked?: boolean;
  onClose?: () => void;
}

const mb = (n: number) => `${(n / 1048576).toFixed(n > 10485760 ? 0 : 1)} MB`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** What each download is, in the order shown. */
const DOWNLOADS: { id: string; label: string; test: RegExp; note: string }[] = [
  { id: 'apk', label: 'Android', test: /\.apk$/i, note: 'Open the file on the phone and allow installing from that source once. New versions install over the old one.' },
  { id: 'win', label: 'Windows installer', test: /windows-setup\.exe$/i, note: 'Keeps itself up to date. Windows warns about an unknown publisher: the build is not code-signed.' },
  { id: 'winp', label: 'Windows portable', test: /windows-portable\.exe$/i, note: 'Runs from anywhere without installing. Download a new file to update.' },
  { id: 'appimage', label: 'Linux AppImage', test: /\.AppImage$/i, note: 'Make it executable (chmod +x) and run it. It updates itself.' },
  { id: 'deb', label: 'Linux .deb', test: /\.deb$/i, note: 'Install with sudo apt install ./file.deb.' },
  { id: 'web', label: 'Your own web server', test: /-web\.zip$/i, note: 'Unzip, then run node serve.mjs --https. Other devices open the address it prints.' },
];

/**
 * The home screen, in two screens that snap into place as you scroll. The first has what you start with: a shape for a new
 * project, your recent projects, open and import, and the update line at its bottom edge. Scrolling a little completes the
 * scroll to the second: the guides and how to get TurboCut on other devices. The top right holds the "show this at startup"
 * switch. A full-screen layer over the editor (or, with the bottom dock, a page above the dock).
 */
export function openHome(deps: HomeDeps): { close: () => void; el: HTMLElement } {
  const { store } = deps;
  const root = h('div', { class: `home${deps.docked ? ' docked' : ''}`, role: 'dialog', 'aria-label': 'Home' });
  const close = () => {
    root.remove();
    deps.onClose?.();
  };

  const start = (w: number, hh: number) => {
    if (store.project.width !== w || store.project.height !== hh) store.edit((p) => ((p.width = w), (p.height = hh)));
    close();
  };
  const startCard = (title: string, sub: string, w: number, hh: number) =>
    h('button', { class: 'home-start btn', onclick: () => start(w, hh) },
      h('span', { class: 'home-frame', 'aria-hidden': 'true' }, h('span', { class: 'home-ratio', style: `--r: ${(w / hh).toFixed(4)}` })),
      h('strong', {}, title), h('small', { class: 'hint' }, sub));

  // ---- recent projects
  const recent = h('section', { class: 'home-recent', hidden: true });
  const drawRecent = (rows: RecentEntry[]) => {
    recent.hidden = rows.length === 0;
    recent.replaceChildren(
      h('h2', { class: 'home-h' }, 'Recent projects'),
      h('div', { class: 'home-recents' }, ...rows.slice(0, 6).map((r) => {
        const open = h('button', { class: 'home-recent-open', type: 'button', 'data-key': r.key, onclick: async () => ((await deps.openRecent(r.key)) && close()) },
          h('span', { class: 'home-frame mini', 'aria-hidden': 'true' }, h('span', { class: 'home-ratio', style: `--r: ${(r.width / Math.max(1, r.height)).toFixed(4)}` })),
          h('span', { class: 'home-recent-text' }, h('strong', {}, r.name), h('small', {}, `${ago(r.at)} · ${clock(r.seconds)} · ${r.width}×${r.height}`)));
        const del = h('button', { class: 'btn btn-ghost icon-btn home-recent-del', type: 'button', 'aria-label': `Remove ${r.name} from the list`, title: 'Remove from the list', onclick: async () => (await forgetRecent(r.key), drawRecent(await listRecent())) }, icon('close', 14));
        return h('div', { class: 'home-recent-item' }, open, del);
      })),
    );
  };
  void listRecent().then(drawRecent);

  // ---- updates
  const updateLine = h('p', { class: 'hint' }, `Version ${APP_VERSION}. Looking for a newer one…`);
  const downloads = h('div', { class: 'home-downloads' }, h('p', { class: 'hint' }, 'Looking up the newest downloads…'));

  const fill = (rel: LatestRelease | null) => {
    const rows = rel
      ? DOWNLOADS.flatMap((d) => {
          const a: ReleaseAsset | undefined = rel.assets.find((x) => d.test.test(x.name));
          return a ? [{ d, a }] : [];
        })
      : [];
    downloads.replaceChildren(
      ...(rows.length
        ? rows.map(({ d, a }) =>
            h('div', { class: 'home-download' },
              h('div', {}, h('strong', {}, d.label), h('span', { class: 'hint' }, ` ${mb(a.size)}`), h('p', { class: 'hint' }, d.note)),
              Object.assign(h('a', { class: 'btn', rel: 'noopener noreferrer', target: '_blank' }, 'Download'), { href: a.url })))
        : [h('p', { class: 'hint' }, 'The downloads could not be listed. They are on the releases page.')]),
      Object.assign(h('a', { class: 'btn btn-ghost', rel: 'noopener noreferrer', target: '_blank' }, 'All releases'), { href: RELEASES }),
    );
  };

  void checkForUpdate().then(
    (s) => {
      updateLine.textContent = s.latest
        ? s.newer
          ? `Version ${s.current}. ${s.latest.version} is available${s.latest.prerelease ? ' (test build)' : ''}.`
          : `Version ${s.current}. You have the newest version.`
        : `Version ${s.current}.`;
      if (s.newer) updateLine.append(' ', h('button', { class: 'btn btn-accent', onclick: () => deps.openSettings('Updates') }, 'Update…'));
      fill(s.latest);
    },
    () => {
      updateLine.textContent = `Version ${APP_VERSION}. Could not check for updates (no connection?).`;
      fill(null);
    },
  );

  const guideButtons = guides.map((g) => h('button', { class: 'btn', onclick: () => openGuides(g.file) }, g.title));

  // The switch in the top right: on = show this screen when TurboCut starts.
  const showBox = h('input', { type: 'checkbox', role: 'switch', checked: store.settings.showHome, 'aria-label': 'Show this screen when TurboCut starts' });
  showBox.addEventListener('change', () => store.updateSettings({ showHome: showBox.checked }));

  const arrive = (el: HTMLElement, i: number) => (el.style.setProperty('--i', String(i)), el.classList.add('home-arrive'), el);
  const quick = (iconName: IconName, title: string, sub: string, run: () => void) =>
    h('button', { class: 'home-quick', onclick: run }, h('span', { class: 'home-quick-ico' }, icon(iconName, 20)), h('span', { class: 'home-quick-text' }, h('strong', {}, title), h('small', {}, sub)));

  const more = h('section', { class: 'home-page home-more', id: 'home-more' },
    h('div', { class: 'home-inner' },
      arrive(h('section', { class: 'home-card' },
        h('h2', {}, 'Learn'),
        h('div', { class: 'home-guides' }, ...guideButtons)), 0),
      arrive(h('section', { class: 'home-card home-get' },
        h('h2', {}, 'Get TurboCut on other devices'),
        platform === 'android'
          ? h('p', { class: 'hint' }, 'This is the Android app. Updates install from inside the app.')
          : h('p', { class: 'hint' }, 'Android, Windows and Linux apps, or run it in a browser from your own computer. Each download is a plain file.'),
        downloads,
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => openGuides('ANDROID_APK.md') }, 'Android install help'), h('button', { class: 'btn', onclick: () => openGuides('WEB_SERVER.md') }, 'Run your own web server'))), 1)));

  const first = h('section', { class: 'home-page home-first' },
    h('div', { class: 'home-inner' },
      arrive(h('header', { class: 'home-bar' },
        h('img', { class: 'home-logo', src: `${import.meta.env.BASE_URL}icon.svg`, alt: '', width: 36, height: 36 }),
        h('span', { class: 'home-word' }, 'TurboCut'),
        h('span', { class: 'spacer' }),
        h('label', { class: 'home-switch', title: 'The Home button at the top brings this screen back' }, h('span', {}, 'Show on startup'), showBox)), 0),
      arrive(h('section', { class: 'home-hero' },
        h('h1', {}, 'What are you making?'),
        h('p', { class: 'lead' }, 'Pick a shape and start cutting. Captions are made for you.')), 1),
      arrive(h('div', { class: 'home-starts' },
        startCard('Vertical short', '9:16 · 1080×1920', 1080, 1920),
        startCard('Landscape', '16:9 · 1920×1080', 1920, 1080),
        startCard('Portrait', '4:5 · 1080×1350', 1080, 1350),
        startCard('Square', '1:1 · 1080×1080', 1080, 1080)), 2),
      arrive(recent, 3),
      arrive(h('div', { class: 'home-quicks' },
        quick('folder', 'Open a project', 'A .turbocut file you saved', async () => ((await deps.openProject()) && close())),
        quick('video', 'Import video', 'Straight into the media bin', async () => ((await deps.importFiles()) && close())),
        quick('settings', 'Make it yours', 'Layouts, fonts and looks', () => deps.openSettings('Layout'))), 4),
      // The update line is the last thing on the first screen. Everything after it waits below the edge.
      arrive(h('section', { class: 'home-card home-updates' },
        h('div', {}, h('h2', {}, 'Updates'), updateLine),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => deps.openSettings('Updates') }, 'Update settings'),
          h('button', { class: 'btn btn-ghost', onclick: () => more.scrollIntoView({ behavior: 'smooth' }) }, 'More', icon('chevron', 14)))), 5)));

  root.append(first, more);
  document.body.append(root);
  root.tabIndex = -1;
  root.focus({ preventScroll: true }); // keyboard users tab into the first shape; nothing is outlined on arrival
  return { close, el: root };
}

import { guides, openGuides } from './guides.ts';
import { h } from './dom.ts';
import { icon, type IconName } from './icons.ts';
import { platform } from './platform.ts';
import type { Store } from './store.ts';
import { checkForUpdate, type LatestRelease, type ReleaseAsset } from './updater.ts';
import { APP_VERSION } from './version.ts';

const RELEASES = 'https://github.com/TurboNZL/turbocut/releases';

export interface HomeDeps {
  store: Store;
  /** Pick video files and put them in the project. */
  importFiles: () => Promise<void>;
  /** Pick a `.turbocut` project file and open it. */
  openProject: () => void;
  openSettings: (tab?: 'Updates' | 'Layout' | 'Fonts') => void;
  onClose?: () => void;
}

const mb = (n: number) => `${(n / 1048576).toFixed(n > 10485760 ? 0 : 1)} MB`;

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
 * The home screen: start a project, see the version and updates, get TurboCut on other devices (APK and the rest, with
 * how to install each), and read the guides. A full-screen layer over the editor; "Start editing" closes it.
 */
export function openHome(deps: HomeDeps): { close: () => void } {
  const { store } = deps;
  const root = h('div', { class: 'home', role: 'dialog', 'aria-label': 'Home' });
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
      h('span', { class: 'home-frame', 'aria-hidden': 'true' }, h('span', { class: 'home-ratio', style: { aspectRatio: `${w} / ${hh}` } })),
      h('strong', {}, title), h('small', { class: 'hint' }, sub));

  // updates
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
  const dontShow = h('input', { type: 'checkbox', checked: !store.settings.showHome, 'aria-label': 'Do not show this at startup' });
  dontShow.addEventListener('change', () => store.updateSettings({ showHome: !dontShow.checked }));

  const arrive = (el: HTMLElement, i: number) => (el.style.setProperty('--i', String(i)), el.classList.add('home-arrive'), el);
  const quick = (iconName: IconName, title: string, sub: string, run: () => void) =>
    h('button', { class: 'home-quick', onclick: run }, h('span', { class: 'home-quick-ico' }, icon(iconName, 20)), h('span', { class: 'home-quick-text' }, h('strong', {}, title), h('small', {}, sub)));

  root.append(
    h('div', { class: 'home-inner' },
      arrive(h('header', { class: 'home-bar' },
        h('img', { class: 'home-logo', src: `${import.meta.env.BASE_URL}icon.svg`, alt: '', width: 36, height: 36 }),
        h('span', { class: 'home-word' }, 'TurboCut'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: close }, 'Start editing')), 0),
      arrive(h('section', { class: 'home-hero' },
        h('h1', {}, 'What are you making?'),
        h('p', { class: 'lead' }, 'Pick a shape and start cutting. Captions are made for you.')), 1),
      arrive(h('div', { class: 'home-starts' },
        startCard('Vertical short', '9:16 · 1080×1920', 1080, 1920),
        startCard('Landscape', '16:9 · 1920×1080', 1920, 1080),
        startCard('Portrait', '4:5 · 1080×1350', 1080, 1350),
        startCard('Square', '1:1 · 1080×1080', 1080, 1080)), 2),
      arrive(h('div', { class: 'home-quicks' },
        quick('folder', 'Open a project', 'A .turbocut file you saved', () => { close(); deps.openProject(); }),
        quick('video', 'Import video', 'Straight into the media bin', () => { close(); void deps.importFiles(); }),
        quick('settings', 'Make it yours', 'Layouts, fonts and looks', () => deps.openSettings('Layout'))), 3),
      arrive(h('div', { class: 'home-cols' },
        h('section', { class: 'home-card' },
          h('h2', {}, 'Updates'),
          updateLine,
          h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => deps.openSettings('Updates') }, 'Update settings'))),
        h('section', { class: 'home-card' },
          h('h2', {}, 'Learn'),
          h('div', { class: 'home-guides' }, ...guideButtons))), 4),
      arrive(h('section', { class: 'home-card home-get' },
        h('h2', {}, 'Get TurboCut on other devices'),
        platform === 'android'
          ? h('p', { class: 'hint' }, 'This is the Android app. Updates install from inside the app.')
          : h('p', { class: 'hint' }, 'Android, Windows and Linux apps, or run it in a browser from your own computer. Each download is a plain file.'),
        downloads,
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => openGuides('ANDROID_APK.md') }, 'Android install help'), h('button', { class: 'btn', onclick: () => openGuides('WEB_SERVER.md') }, 'Run your own web server'))), 5),
      h('label', { class: 'home-foot setting' }, dontShow, h('span', {}, 'Do not show this screen when TurboCut starts. The Home button at the top brings it back.')))
  );
  document.body.append(root);
  root.tabIndex = -1;
  root.focus({ preventScroll: true }); // keyboard users tab into the first shape; nothing is outlined on arrival
  return { close };
}

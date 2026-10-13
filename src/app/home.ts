import { guides, openGuides } from './guides.ts';
import { h, panel } from './dom.ts';
import { platform } from './platform.ts';
import type { Store } from './store.ts';
import { checkForUpdate, type LatestRelease, type ReleaseAsset } from './updater.ts';
import { APP_VERSION } from './version.ts';

const RELEASES = 'https://github.com/TurboNZL/turbocut/releases';

export interface HomeDeps {
  store: Store;
  /** Pick video files and put them in the project. */
  importFiles: () => Promise<void>;
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
      h('span', { class: 'home-ratio', style: { aspectRatio: `${w} / ${hh}` }, 'aria-hidden': 'true' }),
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

  root.append(
    h('div', { class: 'home-inner stack' },
      h('header', { class: 'home-head' },
        h('h1', {}, 'TurboCut'),
        h('p', { class: 'lead' }, 'A light video editor for shorts, with captions made for you.')),
      panel('Start',
        h('div', { class: 'home-starts' },
          startCard('Vertical short', '9:16, 1080×1920', 1080, 1920),
          startCard('Landscape', '16:9, 1920×1080', 1920, 1080),
          startCard('Portrait', '4:5, 1080×1350', 1080, 1350),
          startCard('Square', '1:1, 1080×1080', 1080, 1080)),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-accent', onclick: () => { close(); void deps.importFiles(); } }, 'Import video…'),
          h('button', { class: 'btn', onclick: close }, 'Start editing'))),
      panel('Updates', updateLine, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => deps.openSettings('Updates') }, 'Update settings'))),
      panel('Get TurboCut on other devices',
        platform === 'android'
          ? h('p', { class: 'hint' }, 'This is the Android app. Updates come as a new APK that installs over this one.')
          : h('p', { class: 'hint' }, 'Android, Windows and Linux apps, or run it in a browser from your own computer. Each download is a plain file.'),
        downloads,
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => openGuides('ANDROID_APK.md') }, 'Android install help'), h('button', { class: 'btn', onclick: () => openGuides('WEB_SERVER.md') }, 'Run your own web server'))),
      panel('Guides', h('div', { class: 'row' }, ...guideButtons)),
      panel('Make it yours',
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => deps.openSettings('Layout') }, 'Layouts'),
          h('button', { class: 'btn', onclick: () => deps.openSettings('Fonts') }, 'Fonts'))),
      h('label', { class: 'setting' }, dontShow, h('span', {}, 'Do not show this screen when TurboCut starts. The Home button at the top brings it back.'))),
  );
  document.body.append(root);
  root.querySelector<HTMLElement>('.btn-accent')?.focus();
  return { close };
}

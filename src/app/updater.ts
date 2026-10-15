import { Capacitor } from '@capacitor/core';
import { platform } from './platform.ts';
import { APP_VERSION, compareVersions, isCalVer } from './version.ts';

const REPO = 'TurboNZL/turbocut';

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface LatestRelease {
  version: string;
  tag: string;
  pageUrl: string;
  notes: string;
  published: string;
  prerelease: boolean;
  assets: ReleaseAsset[];
}

/** The newest TurboCut release (by version number, not by date) from the public GitHub API. */
export function pickLatest(releases: any[]): LatestRelease | null {
  const usable = releases
    .filter((r) => r && !r.draft && typeof r.tag_name === 'string' && isCalVer(r.tag_name))
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  const r = usable[0];
  if (!r) return null;
  return {
    version: r.tag_name.replace(/^v/, ''),
    tag: r.tag_name,
    pageUrl: r.html_url,
    notes: String(r.body ?? ''),
    published: String(r.published_at ?? ''),
    prerelease: !!r.prerelease,
    assets: (r.assets ?? []).map((a: any) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
  };
}

export async function fetchLatest(fetchImpl: typeof fetch = fetch): Promise<LatestRelease | null> {
  const res = await fetchImpl(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return pickLatest(await res.json());
}

export interface UpdateStatus {
  current: string;
  latest: LatestRelease | null;
  newer: boolean;
}

export async function checkForUpdate(fetchImpl?: typeof fetch): Promise<UpdateStatus> {
  const latest = await fetchLatest(fetchImpl);
  return { current: APP_VERSION, latest, newer: !!latest && compareVersions(latest.version, APP_VERSION) > 0 };
}

/** The file to download for this platform from a release, or null if there is none. */
export function assetFor(release: LatestRelease, p: typeof platform = platform, os: string = globalThis.navigator?.platform ?? ''): ReleaseAsset | null {
  const find = (re: RegExp) => release.assets.find((a) => re.test(a.name)) ?? null;
  if (p === 'android') return find(/\.apk$/i);
  if (p === 'electron') return /win/i.test(os) ? find(/windows-setup\.exe$/i) : find(/\.AppImage$/i) ?? find(/\.deb$/i);
  return null;
}

/** What installing an update answers. Only a failure comes back (on success the app restarts); a failed .deb install carries the command to run by hand. */
export type InstallResult = { ok: true } | { ok: false; message: string; command?: string };

export interface DesktopUpdater {
  check(): Promise<{ supported: boolean; reason?: string; version?: string }>;
  download(): Promise<void>;
  install(): Promise<InstallResult | void>;
  onProgress(fn: (percent: number) => void): void;
}

/** The desktop shell's own updater (Electron), if this is the packaged desktop app. */
export const desktopUpdater: DesktopUpdater | undefined = (globalThis as any).turbocut?.updater;

/**
 * What "update" means on each platform:
 *  - desktop app (installer or AppImage): the app downloads the new version itself and restarts into it;
 *  - Android: the APK is opened for download; Android then asks to install it over the current one;
 *  - web: reload, the hosted page is always the newest version.
 */
export async function openApk(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } else window.open(url, '_blank');
}

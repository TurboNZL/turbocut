import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { assetFor, pickLatest } from '../src/app/updater.ts';
import { compareVersions, isCalVer, parseVersion } from '../src/app/version.ts';

const rel = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/TurboNZL/turbocut/releases/tag/${tag}`,
  body: `notes for ${tag}`,
  published_at: '2026-10-13T00:00:00Z',
  draft: false,
  prerelease: true,
  assets: [
    { name: 'TurboCut-android-9.apk', browser_download_url: 'https://x/a.apk', size: 13e6 },
    { name: `TurboCut-${tag.slice(1)}-windows-setup.exe`, browser_download_url: 'https://x/w.exe', size: 111e6 },
    { name: `TurboCut-${tag.slice(1)}-linux-x86_64.AppImage`, browser_download_url: 'https://x/l.AppImage', size: 127e6 },
    { name: `TurboCut-${tag.slice(1)}-linux-amd64.deb`, browser_download_url: 'https://x/l.deb', size: 100e6 },
  ],
  ...extra,
});

describe('versions (Year.Month.Update)', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions('2026.10.2', '2026.10.10')).toBeLessThan(0);
    expect(compareVersions('2026.9.30', '2026.10.1')).toBeLessThan(0);
    expect(compareVersions('2027.1.1', '2026.12.99')).toBeGreaterThan(0);
    expect(compareVersions('v2026.10.1', '2026.10.1')).toBe(0);
  });
  it('recognises the scheme', () => {
    expect(isCalVer('v2026.10.3')).toBe(true);
    expect(isCalVer('build-1')).toBe(false);
    expect(parseVersion('nonsense')).toEqual([0, 0, 0]);
  });
});

describe('pickLatest', () => {
  it('chooses the highest version even when a lower one was published later', () => {
    const latest = pickLatest([rel('v2026.10.2', { published_at: '2026-10-20T00:00:00Z' }), rel('v2026.10.10'), rel('v2026.9.40')]);
    expect(latest?.version).toBe('2026.10.10');
  });
  it('ignores drafts and old-style build tags', () => {
    const latest = pickLatest([rel('build-7'), rel('v2026.11.1', { draft: true }), rel('v2026.10.4')]);
    expect(latest?.version).toBe('2026.10.4');
    expect(pickLatest([rel('build-1')])).toBeNull();
  });
});

describe('assetFor', () => {
  const latest = pickLatest([rel('v2026.10.4')])!;
  it('picks the right file for each platform', () => {
    expect(assetFor(latest, 'android')?.name).toMatch(/\.apk$/);
    expect(assetFor(latest, 'electron', 'Win32')?.name).toMatch(/windows-setup\.exe$/);
    expect(assetFor(latest, 'electron', 'Linux x86_64')?.name).toMatch(/\.AppImage$/);
    expect(assetFor(latest, 'web')).toBeNull();
  });
});

describe('.deb install (electron/debInstall.cjs)', () => {
  const deb = createRequire(import.meta.url)('../electron/debInstall.cjs');
  it('quotes paths so odd file names cannot break out of the shell', () => {
    expect(deb.shQuote("a'b")).toBe(`'a'\\''b'`);
    expect(deb.debInstallScript("/tmp/x y/it's.deb")).toBe(`dpkg -i '/tmp/x y/it'\\''s.deb' || apt-get install -f -y`);
    expect(deb.manualInstallCommand('/tmp/t.deb')).toBe("sudo apt install '/tmp/t.deb'");
  });
  it('explains each pkexec outcome', () => {
    expect(deb.describePkexec(0)).toEqual({ ok: true });
    expect(deb.describePkexec(126)).toMatchObject({ ok: false, cancelled: true });
    expect(deb.describePkexec(127)).toMatchObject({ ok: false, cancelled: false });
    expect(deb.describePkexec(1, 'Error: Not authorized')).toMatchObject({ cancelled: false });
    expect(deb.describePkexec(100, 'a\nb\nc\nd').message).toContain('exit code 100');
  });
  it('spots no_new_privs and restarts the terminal outside the app process tree', () => {
    expect(deb.hasNoNewPrivs('Name:\tx\nNoNewPrivs:\t1\nSeccomp:\t0\n')).toBe(true);
    expect(deb.hasNoNewPrivs('NoNewPrivs:\t0\n')).toBe(false);
    const run = deb.outsideTree('xterm', ['-e', 'x'], { DISPLAY: ':0', HOME: '/h' });
    expect(run.bin).toBe('systemd-run');
    expect(run.args).toEqual(['--user', '--collect', '--wait', '--quiet', '--setenv=DISPLAY', '--', 'xterm', '-e', 'x']);
  });
  it('treats a release whose installers are not attached yet as not an error, and compares installed versions exactly', () => {
    expect(deb.isStillBuilding('Cannot find latest-linux.yml in the latest release artifacts')).toBe(true);
    expect(deb.isStillBuilding('getaddrinfo ENOTFOUND github.com')).toBe(false);
    expect(deb.installedMatches('2026.10.3\n', '2026.10.3')).toBe(true);
    expect(deb.installedMatches('2026.10.2', '2026.10.3')).toBe(false);
  });
});

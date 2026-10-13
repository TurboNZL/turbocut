// The home screen: start a project, update status, downloads from the newest release, guides, and "don't show again".
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launch } from './browser.mjs';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}e2e/.out/`;
mkdirSync(out, { recursive: true });
const server = await createServer({ root, server: { port: 5217, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await launch();
const errors = [];
const asset = (name, size = 5e6) => ({ name, browser_download_url: `https://example.com/${name}`, size });
const release = (tag) => ({ tag_name: tag, html_url: `https://github.com/TurboNZL/turbocut/releases/tag/${tag}`, body: '', published_at: '2026-10-13T00:00:00Z', draft: false, prerelease: true,
  assets: ['android.apk', 'windows-setup.exe', 'windows-portable.exe', 'linux-x86_64.AppImage', 'linux-amd64.deb', 'web.zip', 'latest.yml'].map((n) => asset(`turbocut-${tag.slice(1)}-${n}`)) });
try {
  const open = async (handler) => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, home: true })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://api.github.com/**', handler);
    await page.goto('http://localhost:5217/');
    await page.waitForFunction(() => window.turbocutApp);
    return page;
  };
  const ok = (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([release('v2026.10.2'), release('v2026.10.12')]) });

  const page = await open(ok);
  await page.getByRole('dialog', { name: 'Home' }).waitFor();
  assert.equal(await page.locator('.home-start').count(), 4, 'four starting shapes');
  await page.waitForFunction(() => /available/.test(document.querySelector('.home').textContent));
  assert.match(await page.locator('.home').textContent(), /2026\.10\.12 is available/, 'newest by version number');
  const links = await page.$$eval('.home-download a', (as) => as.map((a) => a.getAttribute('href')));
  assert.equal(links.length, 6, 'one download per file');
  assert.ok(links.includes('https://example.com/turbocut-2026.10.12-android.apk'));
  assert.ok(!links.some((l) => l.includes('latest.yml')), 'update manifests are not offered as downloads');
  await page.screenshot({ path: `${out}home.png`, fullPage: true });

  // the Android help opens the guide
  await page.getByRole('button', { name: 'Android install help' }).click();
  await page.getByRole('dialog', { name: 'Guides' }).waitFor();
  assert.match(await page.locator('.guide-page').textContent(), /Install unknown apps/);
  await page.locator('.dlg .bt-close').click();

  // choosing a shape sets the project and closes the screen
  await page.getByRole('button', { name: /Landscape/ }).click();
  assert.equal(await page.locator('.home').count(), 0, 'home closed');
  assert.deepEqual(await page.evaluate(() => [window.turbocutApp.store.project.width, window.turbocutApp.store.project.height]), [1920, 1080]);

  // the Home button brings it back, and only one at a time
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Home', exact: true }).click({ force: true }).catch(() => {});
  assert.equal(await page.locator('.home').count(), 1);

  // "do not show" persists
  await page.getByLabel('Do not show this at startup').check();
  await page.getByRole('button', { name: 'Start editing' }).click();
  await page.reload();
  await page.waitForFunction(() => window.turbocutApp);
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.home').count(), 0, 'stays hidden after a restart');

  // offline: no crash, a way to the releases page
  const offline = await open((route) => route.abort());
  await offline.waitForFunction(() => /Could not check/.test(document.querySelector('.home').textContent));
  assert.ok((await offline.locator('.home a', { hasText: 'All releases' }).getAttribute('href')).endsWith('/releases'));
  assert.deepEqual(errors, []);
  console.log('home e2e passed');
} finally {
  await browser.close();
  await server.close();
}

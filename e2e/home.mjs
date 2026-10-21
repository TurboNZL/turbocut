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
  // the page takes focus when it opens; a focus ring round the whole screen (seen on a phone) must not be drawn
  assert.equal(await page.locator('.home').evaluate((el) => (el === document.activeElement || el.contains(document.activeElement)) && getComputedStyle(el).outlineStyle), 'none', 'no focus ring round the home screen');
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
  assert.equal(await page.getByRole('button', { name: 'Start editing' }).count(), 0, 'there is no loose "Start editing" button any more');

  // two screens: the first ends with the update line, everything after it (guides, other devices) is below the edge until you scroll
  const vh = await page.evaluate(() => innerHeight);
  const first = await page.locator('.home-first').boundingBox();
  const more = await page.locator('.home-more').boundingBox();
  assert.ok(first.height >= vh - 2, `the first screen fills the window (${first.height} of ${vh})`);
  assert.ok(more.y >= vh - 2, `Learn and the downloads start below the first screen (${more.y})`);
  const upd = await page.locator('.home-updates').boundingBox();
  assert.ok(upd.y + upd.height <= vh, 'the update line is on the first screen');
  assert.ok(await page.getByText('Get TurboCut on other devices').evaluate((el) => el.getBoundingClientRect().top > innerHeight), 'the downloads are off screen at first');
  // scrolling a little finishes the scroll by itself (snap)
  await page.locator('.home').evaluate((el) => el.scrollBy({ top: 120 }));
  await page.waitForFunction(() => document.querySelector('.home').scrollTop >= innerHeight - 4, null, { timeout: 5000 });
  assert.ok(await page.getByText('Get TurboCut on other devices').isVisible());
  await page.locator('.home').evaluate((el) => el.scrollTo({ top: 0 }));

  // the "show on startup" switch is in the top right, on by default
  const sw = page.getByRole('switch', { name: 'Show this screen when TurboCut starts' });
  const swBox = await sw.boundingBox();
  assert.ok(swBox.x > 900 && swBox.y < 100, `the switch sits in the top right (${swBox.x}, ${swBox.y})`);
  assert.equal(await sw.isChecked(), true);
  await sw.uncheck();
  assert.equal(await page.evaluate(() => window.turbocutApp.store.settings.showHome), false);
  await page.getByRole('button', { name: /Vertical short/ }).click();
  await page.reload();
  await page.waitForFunction(() => window.turbocutApp);
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.home').count(), 0, 'stays hidden after a restart');

  // opening a project and backing out of the file picker does not drop you into the editor
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Open a project/ }).click()]);
  await chooser.setFiles([]); // cancelled
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.home').count(), 1, 'cancelling the picker leaves the home screen where it was');
  const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Import video/ }).click()]);
  await chooser2.setFiles([]);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.home').count(), 1, 'and so does cancelling an import');

  // recent projects: nothing to list yet; after some work (kept a few seconds after the last change) it is one tap away on the next start
  assert.equal(await page.locator('.home-recent').isVisible(), false, 'no recent list while there is nothing to list');
  await page.getByRole('button', { name: /Vertical short/ }).click();
  const media = (await import('node:fs')).readFileSync(`${root}e2e/.media/src.webm`).toString('base64');
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.turbocutApp.importMedia([new File([bytes], 'clip.webm', { type: 'video/webm' })], true);
    window.turbocutApp.store.edit((p) => (p.name = 'My short'));
  }, media);
  await page.waitForTimeout(4600); // the copy is kept 4 s after the last change
  await page.evaluate(() => window.turbocutApp.store.updateSettings({ showHome: true }));
  await page.reload();
  await page.waitForFunction(() => window.turbocutApp);
  await page.locator('.home').waitFor(); // an empty project at start: the home screen shows by itself
  const recent = page.locator('.home-recent-open', { hasText: 'My short' });
  await recent.waitFor();
  assert.match(await recent.textContent(), /1080×1920/);
  // every recent project's picture stays inside its little frame, whatever the shape
  const escaping = await page.evaluate(() => [...document.querySelectorAll('.home-frame.mini .home-ratio')].filter((r) => { const a = r.getBoundingClientRect(); const b = r.parentElement.getBoundingClientRect(); return a.width > b.width + 0.5 || a.height > b.height + 0.5; }).length);
  assert.equal(escaping, 0, 'recent project pictures stay inside their frames');
  await page.screenshot({ path: `${out}home-recent.png` });
  await recent.click();
  await page.waitForFunction(() => window.turbocutApp.store.project.name === 'My short');
  assert.equal(await page.locator('.home').count(), 0, 'opening a recent project closes the home screen');
  assert.equal(await page.evaluate(() => window.turbocutApp.store.missingAssets().length), 1, 'the media is asked for again, like opening a file');
  await page.getByRole('dialog', { name: 'Find the media' }).waitFor();
  await page.locator('.dlg .bt-close').click();
  // it can be taken off the list
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: /Remove My short from the list/ }).click();
  await page.waitForFunction(() => !document.querySelector('.home-recent-open'));

  // offline: no crash, a way to the releases page
  const offline = await open((route) => route.abort());
  await offline.waitForFunction(() => /Could not check/.test(document.querySelector('.home').textContent));
  assert.ok((await offline.locator('.home a', { hasText: 'All releases' }).getAttribute('href')).endsWith('/releases'));
  assert.deepEqual(errors, []);
  // ---- a phone: every shape tile keeps its picture inside, and the whole first screen fits (two screens, as on a computer)
  {
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, home: true })).newPage();
    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.route('https://api.github.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await phone.goto('http://localhost:5217/');
    await phone.waitForSelector('.home-start');
    await phone.waitForTimeout(1200);
    const m = await phone.evaluate(() => ({
      outside: [...document.querySelectorAll('.home-ratio')].filter((r) => { const a = r.getBoundingClientRect(); const b = r.closest('.home-start').getBoundingClientRect(); return a.left < b.left || a.right > b.right || a.bottom > b.bottom; }).length,
      overflow: document.querySelector('.home-first .home-inner').scrollHeight - document.querySelector('.home').clientHeight,
      snap: getComputedStyle(document.querySelector('.home')).scrollSnapType,
    }));
    assert.equal(m.outside, 0, 'no shape picture escapes its tile on a phone');
    assert.ok(m.overflow <= 0, `the first screen fits a tall phone (over by ${m.overflow}px)`);
    assert.equal(m.snap, 'y mandatory', 'two stops on a tall phone, as on a computer');
    await phone.context().close();
  }
  console.log('home e2e passed');
} finally {
  await browser.close();
  await server.close();
}

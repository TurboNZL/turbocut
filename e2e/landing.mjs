// The landing page picks the right download for the visitor from the newest release, and degrades when GitHub is unreachable.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { launch } from './browser.mjs';

const root = new URL('..', import.meta.url).pathname;
const server = http.createServer((req, res) => (res.writeHead(200, { 'content-type': 'text/html' }), res.end(readFileSync(`${root}site/index.html`)))).listen(5211);
const browser = await launch();
const asset = (name) => ({ name, browser_download_url: `https://example.com/${name}`, size: 1 });
const release = (tag) => ({ tag_name: tag, html_url: `https://github.com/TurboNZL/turbocut/releases/tag/${tag}`, draft: false, prerelease: true,
  assets: ['android.apk', 'windows-setup.exe', 'windows-portable.exe', 'linux-x86_64.AppImage', 'linux-amd64.deb', 'web.zip', 'latest.yml'].map((n) => asset(`TurboCut-${tag.slice(1)}-${n}`)) });
const errors = [];
try {
  const open = async (userAgent, handler) => {
    const page = await (await browser.newContext({ userAgent })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://api.github.com/**', handler);
    await page.goto('http://localhost:5211/');
    return page;
  };
  const ok = (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([release('v2026.10.2'), release('v2026.10.11'), release('build-1')]) });

  const phone = await open('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36', ok);
  await phone.waitForFunction(() => /Newest/.test(document.getElementById('version').textContent));
  assert.match(await phone.textContent('#version'), /2026\.10\.11/, 'newest by version number, not by order or date');
  assert.equal(await phone.getAttribute('#main-download', 'href'), 'https://example.com/TurboCut-2026.10.11-android.apk');
  assert.equal(await phone.textContent('#main-download'), 'Download for Android');
  assert.equal(await phone.locator('#downloads a').count(), 6, 'one button per file');
  assert.equal(await phone.locator('.fallback').count(), 0);

  const pc = await open('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', ok);
  await pc.waitForFunction(() => /Newest/.test(document.getElementById('version').textContent));
  assert.equal(await pc.getAttribute('#main-download', 'href'), 'https://example.com/TurboCut-2026.10.11-windows-setup.exe');

  const down = await open('Mozilla/5.0 (X11; Linux x86_64) Chrome/120', (route) => route.abort());
  await down.waitForFunction(() => /Could not look up/.test(document.getElementById('version').textContent));
  assert.match(await down.getAttribute('#main-download', 'href'), /releases$/);
  assert.equal(await down.locator('a[href="app/"]').count(), 1, 'the browser app link works without GitHub');
  await phone.screenshot({ path: `${root}e2e/.out/landing.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log('landing e2e passed');
} finally {
  await browser.close();
  server.close();
}

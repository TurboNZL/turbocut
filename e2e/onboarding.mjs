// First-run setup: shown once; a config file skips it; otherwise the speech model and the device name; closing it never traps the person.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launch } from './browser.mjs';

const root = new URL('..', import.meta.url).pathname;
const server = await createServer({ root, server: { port: 5231, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await launch();
const errors = [];
try {
  const open = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false })); // the app skips the setup under automation
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:5231/');
    await page.waitForFunction(() => window.turbocutApp);
    return page;
  };
  const dlg = (p) => p.getByRole('dialog', { name: 'Welcome to TurboCut' });

  // the long way: no config, pick the balanced model for later, name the device
  let page = await open();
  await dlg(page).waitFor();
  await dlg(page).getByRole('button', { name: 'No, set up from scratch' }).click();
  await dlg(page).getByLabel(/^Balanced/).check();
  await dlg(page).getByRole('button', { name: 'Choose it, download later' }).click();
  await dlg(page).getByLabel('Device name').fill('Test box');
  await dlg(page).getByRole('button', { name: /Link with a computer|Done/ }).click();
  await page.waitForFunction(() => window.turbocutApp.store.settings.onboarded);
  const s = await page.evaluate(() => window.turbocutApp.store.settings);
  assert.equal(s.transcribe.modelChosen, true);
  assert.match(s.transcribe.model, /whisper-base/);
  assert.equal(s.deviceName, 'Test box');
  await page.reload();
  await page.waitForFunction(() => window.turbocutApp);
  await page.waitForTimeout(500);
  assert.equal(await dlg(page).count(), 0, 'it is shown once');
  await page.context().close();

  // a config file ends it at once
  page = await open();
  await dlg(page).waitFor();
  const cfg = JSON.stringify({ format: 'turbocut.config', version: 1, settings: { snapping: false, uiScale: 110 } });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), dlg(page).getByRole('button', { name: 'Choose a config file…' }).click()]);
  await chooser.setFiles({ name: 'mine.conf', mimeType: 'application/json', buffer: Buffer.from(cfg) });
  await page.waitForFunction(() => window.turbocutApp.store.settings.onboarded);
  const t = await page.evaluate(() => window.turbocutApp.store.settings);
  assert.equal(t.snapping, false);
  assert.equal(t.uiScale, 110);
  assert.equal(await dlg(page).count(), 0);
  await page.context().close();

  // closing it with Escape skips it and does not ask again
  page = await open();
  await dlg(page).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.turbocutApp.store.settings.onboarded);
  assert.deepEqual(errors, []);
  console.log('onboarding e2e passed');
} finally {
  await browser.close();
  await server.close();
}

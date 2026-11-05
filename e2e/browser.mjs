import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

// The home screen covers the editor at startup. The suites test the editor, so every context they open starts with
// "show the home screen" off (only if the page has no saved settings yet, so a reload keeps whatever the test saved).
// A test that wants the home screen passes { home: true } to newContext.
const hideHome = () => {
  try {
    if (!localStorage.getItem('turbocut.settings')) localStorage.setItem('turbocut.settings', JSON.stringify({ settingsVersion: 2, showHome: false }));
  } catch {
    /* storage blocked */
  }
};

// The default frame rate is 60. Several suites do their frame arithmetic at 30 (a 6 s clip is 180 frames, a seek to 60 is
// "2 s"), so they ask for { fps: 30 }: the project is pinned to 30 fps the moment the app exposes itself, before any test code runs.
// Suites that pass nothing (run, keys, electron) exercise the real default.
const pinFps = (fps) => {
  let app;
  Object.defineProperty(window, 'turbocutApp', {
    configurable: true,
    get: () => app,
    set: (v) => {
      v.store.project.fps = fps;
      app = v;
    },
  });
};

// Project files without a real file dialog. The desktop shell saves and opens through `window.turbocut.project` (a save dialog, a path);
// headless Chromium cannot show a dialog, so a suite that passes { files: true } gets the same API backed by localStorage ("the disk").
// `window.__files` lets the test answer the dialogs and see what was written.
const fakeFiles = () => {
  const KEY = 'e2e.disk';
  const disk = () => JSON.parse(localStorage.getItem(KEY) || '{}');
  const put = (o) => localStorage.setItem(KEY, JSON.stringify(o));
  // The save dialog offers the full project first; the older suites save plain `.turbocut` files, so by default the fake answers with that.
  const files = (window.__files = { saveAsPath: (name) => `/fake/${name.replace(/\.turbocutf$/, '.turbocut')}`, openPath: null, saveAsCalls: [], writes: [], disk });
  const pending = {};
  let n = 0;
  const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
  window.turbocut = {
    project: {
      choose: async (name) => {
        const path = files.saveAsPath(name);
        files.saveAsCalls.push(name);
        return path ? { path } : null;
      },
      write: async (path, text) => {
        files.writes.push(path);
        put({ ...disk(), [path]: text });
      },
      // A bundle arrives in pieces; the disk keeps it as base64 under { b64 }.
      writeStart: async (path) => ((pending[++n] = { path, parts: [] }), String(n)),
      writeChunk: async (id, bytes) => void pending[id].parts.push(b64(new Uint8Array(bytes))),
      writeEnd: async (id, commit) => {
        const w = pending[id];
        delete pending[id];
        if (!commit) return;
        files.writes.push(w.path);
        put({ ...disk(), [w.path]: { parts: w.parts } });
      },
      read: async (path) => {
        const d = disk();
        if (!(path in d)) throw new Error('ENOENT: no such file');
        return { text: d[path] };
      },
      open: async () => (files.openPath && files.openPath in disk() ? { path: files.openPath, text: /\.turbocut[cf]$/.test(files.openPath) ? null : disk()[files.openPath] } : null),
    },
  };
};

/** The fake shell's bundle files, as the desktop app serves them: GET /project/<encoded path>. */
export async function serveFakeBundles(page) {
  await page.route('**/project/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/project\//, ''));
    const entry = await page.evaluate((p) => window.__files.disk()[p], path);
    if (!entry?.parts) return route.fulfill({ status: 404, body: 'Not found' });
    return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.concat(entry.parts.map((x) => Buffer.from(x, 'base64'))) });
  });
}

/**
 * Launch Chromium for the e2e scripts. CHROMIUM_PATH wins, then the sandbox's preinstalled build,
 * then Playwright's own download (what CI installs with `playwright-core install chromium`).
 */
export async function launch(args = []) {
  const path = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch({ executablePath: path, args });
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options = {}) => {
    const { home, fps, files, ...rest } = options;
    const ctx = await newContext(rest);
    if (!home) await ctx.addInitScript(hideHome);
    if (fps) await ctx.addInitScript(pinFps, fps);
    if (files) await ctx.addInitScript(fakeFiles);
    // The browser's own file pickers cannot be driven here: the download and file-chooser paths are what the suites exercise unless they ask for `files`.
    if (!files) await ctx.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
    return ctx;
  };
  browser.newPage = async (options = {}) => (await browser.newContext(options)).newPage();
  return browser;
}

/**
 * Choose an option of a drop-down the way a person does: open the themed list and press the row. Every `select.input` is drawn by
 * the theme now (`enhanceSelects()` from turbothemes), so the native element is hidden and `selectOption` cannot reach it. `value` is the option's value;
 * `within` narrows where to look (a dialog, say).
 */
export async function pick(page, label, value, within = page) {
  const sel = within.locator(`select[aria-label="${label}"]`).first();
  const text = await sel.evaluate((s, v) => [...s.options].find((o) => o.value === v)?.textContent, value);
  if (text == null) throw new Error(`"${label}" has no option with the value ${value}`);
  await within.locator(`button.themed-select[aria-label="${label}"]`).first().click();
  await page.locator('.themed-select-menu .ts-option', { hasText: text }).first().click();
}

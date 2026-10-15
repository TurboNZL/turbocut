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

/**
 * Launch Chromium for the e2e scripts. CHROMIUM_PATH wins, then the sandbox's preinstalled build,
 * then Playwright's own download (what CI installs with `playwright-core install chromium`).
 */
export async function launch(args = []) {
  const path = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch({ executablePath: path, args });
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options = {}) => {
    const { home, fps, ...rest } = options;
    const ctx = await newContext(rest);
    if (!home) await ctx.addInitScript(hideHome);
    if (fps) await ctx.addInitScript(pinFps, fps);
    return ctx;
  };
  browser.newPage = async (options = {}) => (await browser.newContext(options)).newPage();
  return browser;
}

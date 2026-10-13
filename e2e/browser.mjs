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

/**
 * Launch Chromium for the e2e scripts. CHROMIUM_PATH wins, then the sandbox's preinstalled build,
 * then Playwright's own download (what CI installs with `playwright-core install chromium`).
 */
export async function launch(args = []) {
  const path = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch({ executablePath: path, args });
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options = {}) => {
    const { home, ...rest } = options;
    const ctx = await newContext(rest);
    if (!home) await ctx.addInitScript(hideHome);
    return ctx;
  };
  browser.newPage = async (options = {}) => (await browser.newContext(options)).newPage();
  return browser;
}

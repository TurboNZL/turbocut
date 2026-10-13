import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

/**
 * Launch Chromium for the e2e scripts. CHROMIUM_PATH wins, then the sandbox's preinstalled build,
 * then Playwright's own download (what CI installs with `playwright-core install chromium`).
 */
export function launch(args = []) {
  const path = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  return chromium.launch({ executablePath: path, args });
}

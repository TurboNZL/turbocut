// Guides: every file in docs/guides is readable in the app, links between guides work, and the Markdown renderer cannot inject HTML.
import { readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { launch } from './browser.mjs';

const root = new URL('..', import.meta.url).pathname;
const files = readdirSync(`${root}docs/guides`).filter((f) => f.endsWith('.md'));
const server = await createServer({ root, server: { port: 5219, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await launch();
const errors = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5219/');
  await page.waitForFunction(() => window.turbocutApp);
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.locator('.settings-nav').getByRole('tab', { name: 'Guides', exact: true }).click();
  await page.waitForSelector('.guide-list .tab');
  assert.equal(await page.locator('.guide-list .tab').count(), files.length, 'every guide file is listed');

  for (let i = 0; i < files.length; i++) {
    await page.locator('.guide-list .tab').nth(i).click();
    const text = await page.locator('.guide-page').textContent();
    assert.ok(text.length > 300, `guide ${i} has content`);
    assert.ok(!/\[[^\]]+\]\([^)]+\)/.test(text), `guide ${i}: no raw Markdown links left`);
    assert.ok(!/\*\*|^\s*#/m.test(text), `guide ${i}: no raw Markdown markers left`);
  }
  // tables render as tables, external links open safely, links between guides work
  await page.locator('.guide-list .tab', { hasText: 'Android' }).click();
  assert.ok((await page.locator('.guide-page table').count()) >= 1, 'a table is a table');
  await page.locator('.guide-list .tab', { hasText: 'Getting started' }).click();
  await page.locator('.guide-page a', { hasText: 'Caption styles and fonts' }).click();
  assert.match(await page.locator('.guide-title').textContent(), /Caption styles and fonts/, 'a link to another guide opens it');
  await page.locator('.guide-list .tab', { hasText: 'web server' }).click();
  const ext = await page.locator('.guide-page a[target=_blank]').first().evaluate((a) => [a.rel, a.href]);
  assert.match(ext[0], /noopener/);

  // the renderer: text stays text, unsafe link targets become plain text
  const bad = await page.evaluate(async () => {
    const { renderMarkdown } = await import('/src/app/markdown.ts');
    const el = renderMarkdown('# <img src=x onerror=alert(1)>\n\n<script>window.pwned=1</script> and [click](javascript:window.pwned=2) and [d](data:text/html,x) and [ok](https://example.com)\n\n```\n<b>code</b>\n```\n\n| a | b |\n|---|---|\n| <i>x</i> | y |');
    document.body.append(el);
    return { img: el.querySelectorAll('img, script, i, b').length, links: [...el.querySelectorAll('a')].map((a) => a.href), pwned: window.pwned ?? null, text: el.textContent };
  });
  assert.equal(bad.img, 0, 'no element came out of the text');
  assert.deepEqual(bad.links, ['https://example.com/'], 'only the https link is a link');
  assert.equal(bad.pwned, null);
  assert.match(bad.text, /<script>window\.pwned=1<\/script>/, 'the text is shown, not run');
  assert.deepEqual(errors, []);
  console.log(`guides e2e passed (${files.length} guides)`);
} finally {
  await browser.close();
  await server.close();
}

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { handler, resolveFile } from '../scripts/serve.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'tc-serve-'));
mkdirSync(path.join(root, 'assets'));
writeFileSync(path.join(root, 'index.html'), '<h1>hi</h1>');
writeFileSync(path.join(root, 'assets', 'a.wasm'), 'x');
writeFileSync(path.join(path.dirname(root), 'secret.txt'), 'nope');

const get = (p: string): Promise<{ status: number; type?: string; body: string }> =>
  new Promise((resolve) => {
    const server = http.createServer(handler(root)).listen(0, () => {
      const { port } = server.address() as { port: number };
      http.get({ port, path: p }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => (server.close(), resolve({ status: res.statusCode!, type: res.headers['content-type'], body })));
      });
    });
  });

describe('serve.mjs', () => {
  it('serves index.html for the root and the right type for wasm', async () => {
    expect((await get('/')).body).toBe('<h1>hi</h1>');
    expect((await get('/assets/a.wasm')).type).toBe('application/wasm');
  });
  it('does not leave the folder', async () => {
    expect(resolveFile(root, '/../secret.txt')).toBeNull();
    expect(resolveFile(root, '/%2e%2e/secret.txt')).toBeNull();
    expect(resolveFile(root, '/..%2fsecret.txt')).toBeNull();
    expect((await get('/%2e%2e/secret.txt')).status).toBe(404);
  });
  it('answers 404 for missing files', async () => {
    expect((await get('/nothing.js')).status).toBe(404);
  });
});

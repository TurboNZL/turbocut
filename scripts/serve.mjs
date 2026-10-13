#!/usr/bin/env node
// Serves TurboCut as a web app from this machine, so other devices on the network can open it in a browser with nothing to install.
//
//   node scripts/serve.mjs               http://localhost:8080 (this computer only works fully: see below)
//   node scripts/serve.mjs --https       https on every network address, with a self-signed certificate
//   options: --port 8080  --dir <folder with the built app>  --host 0.0.0.0
//
// Browsers only allow video encoding (WebCodecs) on secure pages: https, or http on localhost. Another device that opens
// http://192.168.x.x:8080 gets the editor but not export, so use --https for that (accept the certificate warning once).
// It needs Node 20+ and, for --https, the openssl command (present on Linux and macOS; on Windows it comes with Git).
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json',
};

/** Resolve a request path inside `root`, or null when it would leave it. A folder serves its index.html. */
export function resolveFile(root, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (rel.includes('\0')) return null;
  const full = path.resolve(root, '.' + path.sep + rel);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  try {
    return statSync(full).isDirectory() ? path.join(full, 'index.html') : full;
  } catch {
    return null;
  }
}

export function handler(root) {
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405).end();
    const file = resolveFile(root, req.url ?? '/');
    if (!file || !existsSync(file)) return void res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file).pipe(res);
  };
}

export const lanAddresses = () =>
  Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);

/** A self-signed certificate valid for localhost and this machine's addresses, kept in ~/.turbocut so the browser's exception sticks. */
function certificate(addresses) {
  const dir = path.join(homedir(), '.turbocut', 'serve');
  const key = path.join(dir, 'key.pem');
  const crt = path.join(dir, `cert-${addresses.join('_') || 'local'}.pem`);
  if (!existsSync(key) || !existsSync(crt)) {
    mkdirSync(dir, { recursive: true });
    const san = ['DNS:localhost', 'IP:127.0.0.1', ...addresses.map((a) => `IP:${a}`)].join(',');
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825', '-subj', '/CN=TurboCut', '-addext', `subjectAltName=${san}`, '-keyout', key, '-out', crt], { stdio: 'ignore' });
    } catch {
      throw new Error('Could not make a certificate: the openssl command is needed for --https. Install it, or run without --https and use localhost.');
    }
  }
  return { key: readFileSync(key), cert: readFileSync(crt) };
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const guess = [path.join(here, '..', 'dist'), path.join(here, 'app')].find((d) => existsSync(path.join(d, 'index.html')));
  const root = path.resolve(opt('--dir', guess ?? ''));
  if (!existsSync(path.join(root, 'index.html'))) {
    console.error('No built app found. Run "pnpm build" first, or pass --dir <folder containing index.html>.');
    process.exit(1);
  }
  const port = Number(opt('--port', '8080'));
  const host = opt('--host', '0.0.0.0');
  const secure = args.includes('--https');
  const addresses = lanAddresses();
  const server = secure ? https.createServer(certificate(addresses), handler(root)) : http.createServer(handler(root));
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Try --port ${port + 1}.` : e.message);
    process.exit(1);
  });
  server.listen(port, host, () => {
    const scheme = secure ? 'https' : 'http';
    console.log(`TurboCut is running. Serving ${root}\n`);
    console.log(`  This computer:  ${scheme}://localhost:${port}/`);
    for (const a of addresses) console.log(`  Other devices:  ${scheme}://${a}:${port}/`);
    if (!secure && addresses.length) console.log('\nOther devices can edit but not export over plain http. Restart with --https to let them export.');
    if (secure) console.log('\nThe browser warns about the certificate the first time: choose to continue (it is your own computer).');
    console.log('\nPress Ctrl+C to stop.');
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

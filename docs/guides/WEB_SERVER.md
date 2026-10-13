# Run TurboCut from your own web server

You can use TurboCut in a browser on any device without installing the desktop app: run the small server on a computer, open its address on the other devices.

1. Download `turbocut-<version>-web.zip` from the Releases page and unzip it.
2. Install [Node.js](https://nodejs.org) 20 or newer.
3. In the folder run: `node serve.mjs --https`
4. It prints an address such as `https://192.168.1.20:8080/`. Open it on any device on the same network and accept the certificate warning once (it is your own computer's self-signed certificate).

## Why `--https`
Browsers only allow video encoding (WebCodecs) on **secure pages**: https, or http on `localhost`. Another device opening `http://192.168.1.20:8080` can edit but not export. `--https` needs the `openssl` command (Linux and macOS have it; on Windows it comes with Git).

## Options
`--port 8080`, `--dir <folder with index.html>`, `--host 0.0.0.0`. From a source checkout: `pnpm build` then `node scripts/serve.mjs --https`.

## Keep in mind
- Projects and fonts live in each browser, not on the server.
- The server only serves files; it does not store anything and does not need the internet once started (on-device captions need to download their model once).
- The first-run certificate is stored in `~/.turbocut/serve` so the browser's exception sticks.

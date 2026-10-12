# TurboCut: project handoff

A lightweight, cross-platform multi-track video editor with built-in auto captions. Read `docs/ARCHITECTURE.md` first.

## Naming
- The product is styled **TurboCut** (capital T, capital C) in everything a person reads: UI, docs, window titles, error messages, comments, commit and PR text.
- Machine identifiers stay lowercase: repo and npm package `turbocut`, file-format tag `turbocut.captionPreset`, CSS/storage prefixes.

## User preferences
- Don't waste their usage. Fact-check and double-check yourself; use web search liberally.
- Reply in normal capitalised prose, not lowercase or slang, even when they write casually.
- Do not create a pull request unless asked. Commit trailers: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and the `Claude-Session` line the harness provides.

## Decisions (don't re-ask)
- One TypeScript web app; Electron for Windows and Ubuntu, Capacitor for Android. No platform-specific app code.
- Themes come from `turbothemes` (TurboNZL/turbothemes), following its `docs/CONTRACT.md`.
- Shorts (9:16, under a minute) are the main case; 16:9 up to about 20 minutes must work. Low friction over detail.
- Time is integer frames. Core is pure and unit tested.
- Captions: presets are importable/exportable JSON; the bounce entrance must match the original `ass_bounce.py` (parity test in `test/captions.test.ts`).
- Transcription runs locally on WebGPU or on a remote GPU server over the LAN; same `Transcriber` interface.
- Twitch import: paste a clip URL; resolver runs outside the page.

## Commands
`pnpm install --ignore-scripts`, `pnpm test`, `pnpm typecheck`, `pnpm e2e` (real export in headless Chromium; run `e2e/make-media.sh` once first; the sandbox Chromium cannot decode H.264).

## Unverified (see ARCHITECTURE.md): Android WebView WebCodecs encode, WebGPU Whisper word timestamps, Twitch resolver.

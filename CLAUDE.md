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
`pnpm install --ignore-scripts`, `pnpm test`, `pnpm typecheck`, `pnpm e2e:electron` (the built app in real Electron under xvfb), `pnpm e2e` (real export in headless Chromium; run `e2e/make-media.sh` once first; the sandbox Chromium cannot decode H.264).

- Fonts: never commit font files (Supercell's Squad Latin Black is proprietary; the user brings it). Users add fonts in the app; `.gitignore` blocks font extensions. Tests that need the real font read it from `e2e/.media/` (ignored).
- Caption outlines use `src/render/outlinedText.ts`: the outline only grows from the outside of the text, so counters (e, a, g) stay clear. A plain centred stroke fills them with outline colour; do not go back to that.
- Canvas `filter: blur()` ignores the canvas transform (measured). Convert project px to device px with the base transform. `pnpm e2e` has a preview-vs-export check with a tight threshold; keep it tight (a loose one passed the bug).
- Export: container follows the video codec (H.264 -> MP4 + AAC, else WebM + Opus). AAC falls back to `@mediabunny/aac-encoder` when the platform has none (Electron on Linux).
- When adding a test for a bug, run it against the broken code first (negative control).
- CI: workflows in `.github/workflows` (ci, android, desktop). Android uses a fixed public debug keystore (`android/debug.keystore`) so test APKs install over each other.

## Unverified (see ARCHITECTURE.md): the Android build and WebView codecs, local Whisper (sandbox cannot reach Hugging Face), Twitch resolver, Windows build.

# TurboCut architecture

Goal: a lightweight multi-track editor where **low friction beats high detail**. Shorts (under a minute, 9:16) are the main case; 16:9 edits up to about 20 minutes must also work.

## Decisions

| Topic | Decision |
|---|---|
| Shape | One TypeScript web app. Electron wraps it for Windows and Ubuntu, Capacitor wraps it for the Android APK. No platform-specific app code; the platform layer is a small adapter (file access, resolver, share). |
| Theme | `turbothemes` (installed from GitHub). Hook classes from its contract, `<turbo-themes-picker>` for choosing a look. |
| Time | Integer frames of the project frame rate everywhere, never float seconds. |
| Core | `src/core`: project model, timeline edits (split, trim, move, ripple delete), keyframes, easing. Pure functions over plain JSON, no DOM, so it is unit tested and shared by every platform. |
| Captions | `src/captions`: ASS parse/write, presets, entrance animation. A **preset** is a JSON pack of style variants plus an animation, importable and exportable, and can be created from any `.ass` file. |
| Bounce | Ported from `ass_bounce.py`; a test runs the original Python and checks the TypeScript curve matches to 12 decimals. Preview uses the exact curve; ASS export bakes it into one `\t` segment per frame so any ASS renderer shows the same motion. |
| Transcription | `src/transcribe`: one `Transcriber` interface. Providers: local (Transformers.js, WebGPU), and **remote** (a small HTTP protocol, see `provider.ts`) so a phone or browser can use a desktop GPU on the LAN. Words are grouped into short cues with `groupWords`. |
| Twitch | `src/twitch`: slug parsing plus a `ClipResolver` interface. The resolver runs outside the page (Electron main, Android native, or LAN host) because of CORS. |

## Render and export pipeline (built)

`src/media` decodes and `src/render` composites (cover fit, x/y/scale/rotation/opacity keyframes, gaussian blur, pixelate, captions with the bounce entrance). `src/export` mixes audio in 30 s windows (a single 20 minute stereo buffer would be ~460 MB) and encodes with mediabunny/WebCodecs. Export prefers H.264 + AAC in MP4 and falls back to VP9/AV1 + Opus in WebM when the runtime cannot encode H.264.

Verified by `pnpm e2e` (headless Chromium, real WebCodecs, checked with ffprobe/ffmpeg): output size, exact frame count, audio present, fade in and out levels; and by eye on extracted frames (cut, blur, caption styles). Not covered by an automated check yet: caption pixel position, zoom keyframe values.

**Measured, and it changed the design.** Per frame at 1080x1920 (software-only sandbox, 4 cores, no GPU): random-access decode 154 ms, pipelined sequential decode 15 ms, VP9 encode 37 ms. Export therefore uses one pipelined decoder per clip (`MediaLibrary.sequential`) and random access only for scrubbing. Output was pixel-identical between the two paths. End-to-end export went from 2.5 to about 12 fps. These are software numbers; GPU and hardware-encoder numbers on real devices are unknown.

Known gaps: box blur and zoom blur (need a shader pass, removed from the type until built); audio speed change shifts pitch; no preview playback loop yet; the first decode of a clip is not pre-warmed.

## The app (built)

`src/app` is plain DOM plus a small `Store` (project, selection, playhead, settings, caption presets; topics `project`, `selection`, `preset`, `settings`...). Undo is whole-project JSON snapshots.

- **Timeline**: tracks of any number of video and audio kinds (order reversible in Settings), linked picture and sound, a media bin, snapping you can switch off, optional low-quality waveforms. On touch the playhead is fixed at the centre and the timeline scrolls; only the selected clip takes a finger, with 32 px trim handles. Zoom: pinch (in place, so the touch target survives), ctrl or alt + wheel (anchored at the cursor), buttons.
- **Settings dialog** (`settingsDialog.ts`): general, remappable hotkeys (`hotkeys.ts`, combos are normalised), captions engine, updates, device check. Settings are validated on load (`settings.ts`) and can be exported and imported.
- **Keyframes** (`core/animation.ts`): one `Param` list drives the inspector, the keyframe dopesheet (under the Clip tab) and next/previous-key jumps. Video: position, scale, rotation, opacity, blur, pixelate. Audio: volume.
- **Text layers**: a clip with `text` (content plus an `AssStyle` and the same entrance animation), drawn by the same outline renderer as captions.
- **Caption styles** (`styleEditor.ts`, `presetIO.ts`): a style is a preset of variants plus an entrance. The built-in one follows the default font and letter-hole settings and is read-only (duplicate it). Export bundles the font files the styles use (base64 in the JSON, `fonts`) unless the box is cleared; import registers and remembers them. Limits are enforced in `parsePresetFile`.
- **Updates**: `updater.ts` reads the public GitHub Releases. Desktop uses electron-updater (the app downloads and restarts); Android opens the APK; web just reloads. Versions are Year.Month.Update (CalVer, `2026.10.3`), stamped by the Build workflow.
- **Home, guides, layouts, fonts**: `home.ts` is the start screen (project shapes, update status, downloads from the newest release, guides); `guides.ts` + `markdown.ts` bundle and render `docs/guides`; `layout.ts`/`layoutManager.ts` and `fontManager.ts` are the managers. There is no hosted site (no GitHub Pages).
- **Web**: `scripts/serve.mjs` is a zero-dependency static server with optional self-signed HTTPS, shipped in the release as `turbocut-<version>-web.zip` for people who want a browser app on their own network without installing the desktop app.

Open items: the Twitch resolver is not implemented; turbothemes still comes from its retired repository (see `development/ENGINE.md`).

## Not verified yet (do not rely on these)

- **Codec support differs by runtime.** The sandbox Chromium has no H.264/AAC encoder (tested with `isConfigSupported`); Electron and Android WebView may. Check at startup with the same negotiation the exporter uses.
- **Android WebView WebCodecs.** Support is listed from WebView 94 on a docs mirror, but I have not confirmed hardware encode, nor tested in a Capacitor app. Needs a device test before the export design is final. Fallback if poor: native MediaCodec encode via a Capacitor plugin.
- **Word timestamps with Transformers.js on WebGPU.** An older upstream issue said they were unsupported; I have not checked whether it was resolved. This is the first thing to prove, because word-by-word captions depend on it. The remote provider and a CPU path are the fallbacks.
- **Twitch resolver.** Community tools fetch a playback token through Twitch's unofficial GraphQL endpoint and append `sig` and `token` to the quality's source URL. The query hash and client id can change without notice, and downloading may conflict with Twitch's terms or the creator's rights. Not implemented; will be tested against a live clip before it is trusted.
- **Web hosting.** WebCodecs and WebGPU need a secure context. A LAN host therefore needs HTTPS (or `localhost`), otherwise they are unavailable in the browser. `serve.mjs --https` was checked with curl on this machine; a second device accepting the self-signed certificate and exporting was not tried.

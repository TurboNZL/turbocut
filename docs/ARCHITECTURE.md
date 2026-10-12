# turbocut architecture

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

## Planned, not built yet

1. Preview and export pipeline: WebCodecs decode, canvas/WebGPU compositing (transform, opacity, blur), WebCodecs encode, a muxer (mediabunny is the candidate).
2. Timeline UI, shortcuts, theme picker wiring.
3. Electron main + preload, Capacitor project.
4. Local Whisper provider, reference transcription server.
5. Twitch resolver implementation.

## Not verified yet (do not rely on these)

- **Android WebView WebCodecs.** Support is listed from WebView 94 on a docs mirror, but I have not confirmed hardware encode, nor tested in a Capacitor app. Needs a device test before the export design is final. Fallback if poor: native MediaCodec encode via a Capacitor plugin.
- **Word timestamps with Transformers.js on WebGPU.** An older upstream issue said they were unsupported; I have not checked whether it was resolved. This is the first thing to prove, because word-by-word captions depend on it. The remote provider and a CPU path are the fallbacks.
- **Twitch resolver.** Community tools fetch a playback token through Twitch's unofficial GraphQL endpoint and append `sig` and `token` to the quality's source URL. The query hash and client id can change without notice, and downloading may conflict with Twitch's terms or the creator's rights. Not implemented; will be tested against a live clip before it is trusted.
- **Web hosting.** WebCodecs and WebGPU need a secure context. A LAN host therefore needs HTTPS (or `localhost`), otherwise they are unavailable in the browser.

# TurboCut

A lightweight multi-track video editor for short vertical clips (and longer 16:9 edits), with built-in automatic captions.
One web codebase; Electron wraps it for Windows and Ubuntu, Capacitor wraps it for Android.

## Features

- Multi-track video and audio timeline, 60 fps by default, with keyframes on every setting (Clip tab).
- Projects save to a small `.turbocut` file and reopen later (the media is found again by name).
- Automatic captions (local Whisper or a GPU server), caption styles and fonts.
- Exports MP4 or WebM in the app; runs on Windows, Ubuntu, Android and the web.

## Get it

The app's own **home screen** lists the newest downloads with install help (and the Guides explain the Android APK step by step). Builds are on the repository's **Releases** page. Every push to `main` or a `claude/*` branch publishes a release named after the version (Year.Month.Update, for example `v2026.10.3`), and the five newest are kept. Each file is a plain download, not a zip (except the web bundle):

| File | What it is |
|---|---|
| `turbocut-<version>-android.apk` | Android. Open it on the phone and allow "install from this source" once. Later builds install over the old one. |
| `turbocut-<version>-windows-setup.exe` | Windows installer; the app then updates itself. Windows may warn about an unknown publisher (not code-signed). |
| `turbocut-<version>-windows-portable.exe` | Windows, runs without installing. |
| `turbocut-<version>-linux-x86_64.AppImage` | Linux: `chmod +x` it and run it; it updates itself. |
| `turbocut-<version>-linux-amd64.deb` | Linux: `sudo apt install ./turbocut-….deb` the first time; after that the app updates itself (it asks for your password). |
| `turbocut-<version>-web.zip` | Your own web server, no desktop app: see below. |

The app checks for updates itself (Settings, Updates).

### Run it as a web server

```sh
node scripts/serve.mjs --https     # from a checkout after `pnpm build`; the web bundle has serve.mjs next to its app folder
```

It prints an address such as `https://192.168.1.20:8080/`. Open it on any device on the network and accept the certificate warning once. Browsers only allow video export (WebCodecs) on secure pages, so other devices need `--https`; on the computer running it, `http://localhost:8080` is enough. Options: `--port`, `--dir`, `--host`. `--https` needs the `openssl` command.

First thing to do on a new device: **Project tab, Device check, Copy report** and send it back. It lists which video and audio codecs the device can encode, whether WebGPU works, and how fast it encodes.

## Using it on a phone

The playhead stays in the middle of the screen and the timeline scrolls under it, so dragging anywhere on the timeline scrubs, with momentum. Tap a clip to select it: it gets large handles on both ends to trim, and you can then drag the clip itself to move it. The bar under the timeline has **Split**, **Trim start** and **Trim end** (both cut to the playhead), **Delete** and zoom. Tap the preview to play or pause. The Clip, Captions and Project panel is a sheet: tap a tab to open it, tap the open tab to close it.

## Develop

```sh
pnpm install --ignore-scripts      # (without --ignore-scripts if you want to run Electron)
pnpm dev                           # http://localhost:5173
pnpm test                          # unit tests
pnpm typecheck
sh e2e/make-media.sh && pnpm e2e   # real exports in headless Chromium (needs ffmpeg; the test font needs python3 fonttools)
pnpm e2e:touch                     # phone layout driven with real touch events (part of pnpm e2e)
pnpm e2e:electron                  # the built app inside Electron (needs xvfb on Linux)
pnpm build && pnpm exec cap sync android   # then open `android/` in Android Studio
```

See `docs/ARCHITECTURE.md` for how it is put together and what is verified.

## Caption styles and fonts

TurboCut does not ship third-party fonts. Add your font file (**Captions → Add font**, or **Settings → General → Add a font file** to also make it the default font) and it is remembered on that device. **Captions → Edit styles…** opens the style editor: duplicate the built-in style, change variants (colour, size, outline, position, letter holes), the entrance animation, and watch the live preview. **Export style** puts the fonts the style uses inside the file unless you untick *Include fonts*; **Import style** installs them again on another device, so share only fonts you may redistribute. Font files are git-ignored on purpose.

## Engine

Built on [TurboNZL/turboengine](https://github.com/TurboNZL/turboengine) (`.turboengine.json` says which commit and modules; `docs/development/ENGINE.md` says what differs).

## License

MIT, see `LICENSE`.

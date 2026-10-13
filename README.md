# TurboCut

A lightweight multi-track video editor for short vertical clips (and longer 16:9 edits), with built-in automatic captions.
One web codebase; Electron wraps it for Windows and Ubuntu, Capacitor wraps it for Android.

## Get a build to try

Every push to `main` or a `claude/*` branch builds the apps and publishes them as a **GitHub Release** (a pre-release named `build-<number>`). Open the repository's **Releases** page and download only the file you want, each one is a plain file, not a zip:

| File | What it is |
|---|---|
| `TurboCut-android-<n>.apk` | Android. Open it on the phone and allow "install from this source" once. Later builds install over the old one. |
| `TurboCut-<version>-windows-setup.exe` | Windows installer. Windows may warn about an unknown publisher (the build is not code-signed). |
| `TurboCut-<version>-windows-portable.exe` | Windows, runs without installing. |
| `TurboCut-<version>-linux-x86_64.AppImage` | Linux: `chmod +x` it and run it. |
| `TurboCut-<version>-linux-amd64.deb` | Linux: `sudo apt install ./TurboCut-….deb`. |

Only the five newest build releases are kept. The **CI** workflow's artifacts (`e2e-output`, `electron-output`) hold screenshots and exported test videos from the automated runs.

First thing to do on a new device: **Project tab, Device check, Copy report** and send it back. It lists which video and audio codecs the device can encode, whether WebGPU works, and how fast it encodes.

## Using it on a phone

The playhead stays in the middle of the screen and the timeline scrolls under it, so dragging anywhere on the timeline scrubs, with momentum. Tap a clip to select it: it gets large handles on both ends to trim, and you can then drag the clip itself to move it. The bar under the timeline has **Split**, **Trim start** and **Trim end** (both cut to the playhead), **Delete** and zoom. Tap the preview to play or pause. The Clip, Captions and Project panel is a sheet: tap a tab to open it, tap the open tab to close it.

## Develop

```sh
pnpm install --ignore-scripts      # (without --ignore-scripts if you want to run Electron)
pnpm dev                           # http://localhost:5173
pnpm test                          # unit tests
pnpm typecheck
sh e2e/make-media.sh && pnpm e2e   # real exports in headless Chromium (needs ffmpeg)
pnpm e2e:touch                     # phone layout driven with real touch events (part of pnpm e2e)
pnpm e2e:electron                  # the built app inside Electron (needs xvfb on Linux)
pnpm build && pnpm exec cap sync android   # then open `android/` in Android Studio
```

See `docs/ARCHITECTURE.md` for how it is put together and what is verified.

## Fonts

TurboCut does not ship third-party fonts. Caption presets name a font (for example "Squad Latin Black"); add the font file under **Captions → Add font** and it is remembered on that device. Font files are git-ignored on purpose.

# TurboCut

A lightweight multi-track video editor for short vertical clips (and longer 16:9 edits), with built-in automatic captions.
One web codebase; Electron wraps it for Windows and Ubuntu, Capacitor wraps it for Android.

## Get a build to try

Every push to `main` or a `claude/*` branch builds installable files. Open the repository's **Actions** tab, pick the latest run of the workflow you want, and download from **Artifacts**:

| Workflow | Artifact | How to use it |
|---|---|---|
| **Android APK** | `TurboCut-android-apk` | Unzip, copy the `.apk` to the phone, open it, allow "install from this source" once. Later builds install over the old one. |
| **Desktop (Windows and Linux)** | `TurboCut-windows` | `…-windows-x64.exe` is the installer; the other `.exe` is portable. Windows may warn about an unknown publisher (the build is not code-signed). |
| | `TurboCut-linux` | `.AppImage`: `chmod +x` it and run. `.deb`: `sudo apt install ./TurboCut-….deb`. |
| **CI** | `e2e-output`, `electron-output` | Screenshots and exported test videos from the automated browser and Electron runs. |

First thing to do on a new device: **Project tab → Device check → Copy report** and send it back. It lists which video and audio codecs the device can encode, whether WebGPU works, and how fast it encodes, which decides how exports behave there.

## Develop

```sh
pnpm install --ignore-scripts      # (without --ignore-scripts if you want to run Electron)
pnpm dev                           # http://localhost:5173
pnpm test                          # unit tests
pnpm typecheck
sh e2e/make-media.sh && pnpm e2e   # real exports in headless Chromium (needs ffmpeg)
pnpm e2e:electron                  # the built app inside Electron (needs xvfb on Linux)
pnpm build && pnpm exec cap sync android   # then open `android/` in Android Studio
```

See `docs/ARCHITECTURE.md` for how it is put together and what is verified.

## Fonts

TurboCut does not ship third-party fonts. Caption presets name a font (for example "Squad Latin Black"); add the font file under **Captions → Add font** and it is remembered on that device. Font files are git-ignored on purpose.

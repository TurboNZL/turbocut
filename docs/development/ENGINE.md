# TurboEngine in TurboCut

TurboCut is pinned to `TurboNZL/turboengine` (`.turboengine.json`). The engine is a reference, not a dependency: this file says what TurboCut took from each module, where it lives here, and what it did differently.

| Module | Used | Where in TurboCut | Difference |
|---|---|---|---|
| `release-pipeline` | yes, adapted | `.github/workflows/build.yml` | Version `vYYYY.M.N` and lowercase asset names as the engine says. Builds on pull requests (artifacts only) and reuses them on merge (`prebuilt-release`); no pre-releases; attaches a web bundle. No `auto-pr.yml`. `ci.yml` replaces `check.yml` and runs on every push. |
| `updaters` | yes, adapted | `src/app/updater.ts`, `electron/updater.cjs` (`setupUpdater`), `electron/debInstall.cjs`, `electron/preload.cjs`, Settings → Updates | Vanilla TypeScript and CommonJS. Uses the newest release including pre-releases, skips drafts; electron-updater for the installer, AppImage and **.deb** (the engine's .deb system: pkexec, sudo terminal, `systemd-run --user`, success confirmed by `dpkg-query`; this is the source of the engine's `variants/vanilla-electron`); the portable build points at the download; Android downloads the APK in-app through a Capacitor plugin (`ApkUpdaterPlugin.java`, now also in the engine's `updaters`). Not copied: the native Kotlin updater (TurboCut has no Kotlin project). |
| `motion` | yes, CSS only | `src/app/motion.css`, used by `dom.ts` (dialogs `tk-pop`, backdrops `tk-fade`, menus `tk-pop`), `main.ts` (tab body `tk-swap`), `inspector.ts` (`tk-swap` on a different clip), `keysPanel.ts` (`tk-expand` on the fold) | The engine's module is React (`useArrivals`, `markFresh`); TurboCut copies only the class vocabulary and replays an animation with a class toggle plus a forced reflow. Reduced motion switches everything off. |
| `logos` | yes | `branding/logo.json`, `scripts/gen-icons.mjs`, `scripts/logo/`, generated icons in `public/`, `build/`, `android/.../res` | Newest schema: the full icon from 96 px up, the coloured symbol alone for favicons (`symbolSvg`, `symbolPng`). Emblem `cut` (a play triangle split by a blade) in cyan `#14c8d8`; the emblem was promoted into the engine. Capacitor's default icon resources were removed. |
| `appearance` | followed as conventions | `src/app/main.ts` (engine start), `src/app/styles.css`, Settings → General (picker) | No React, no Tailwind. `turbothemes/base.css` first, tokens only, hook classes. Layouts are the app's own (`src/app/layout.ts`). Dependency is `turboengine#path:/themes`. |
| `guides-and-docs` | yes | `docs/guides/*.md` bundled by `src/app/guides.ts`, rendered by `src/app/markdown.ts`; `PROJECT_BRIEF.md`; `CLAUDE.md` | Guides show in Settings → Guides, on the home screen, and in a dialog. A safe renderer (text only, no HTML). |
| `settings-shell` | conventions | `src/app/settingsDialog.ts` | Tabs are the engine's token-only tab recipe (`.tab`), panels are `.card.bt-panel`. |
| `system-fonts` | yes (new, from TurboCut) | `src/app/systemFonts.ts`, `src/app/fonts.ts` (`fontChoices`), `src/app/fontManager.ts` | The module's source. Electron lists fonts at start; a browser asks once. |
| `editions`, `window-frame`, `android-shell` | no | | One edition; the native window; a plain Capacitor shell. |

## UI structure (from the engine's INTEGRATION.md and audit)
- Dialog title is an `h2` in a flex `.bt-titlebar` (`dom.ts` `dialog`).
- Settings panels are `section.card.bt-panel` with an `h2.bt-panel-title` first (`dom.ts` `panel`).
- In-page tabs are `.tabs`/`.tab` with `role="tablist"`/`"tab"` and `aria-selected`; never `.bt-tab`/`.bt-tabbar` (those are the phone bottom bar).
- Icons are SVG in `currentColor` (`src/app/icons.ts`: transport, header, track badges, the add-track corner), never emoji or symbol characters.
- The side panel is a `bt-shell` bar, so the floating looks (Liquid Glass, Spotify, One UI) draw it floating and rounded; `styles.css` adds the gap those looks leave out on the right and at the bottom.
- The video preview is a rectangle in every look (a frame is not rounded).
- e2e selectors use `getByRole('tab')` for tabs.

## Not yet done
- **Unverified:** the real .deb install (polkit prompt, terminal fallback, restart) has not been run on a desktop; only the helpers are unit tested.
- `examples/verify-looks.mjs` (engine) has not been run against TurboCut after the structure fixes; the e2e suites and screenshots were.

## Taking improvements back
Things TurboCut learned that other apps could use (APK signing and install, release naming with a web bundle, safe Markdown renderer, font manager, layout manager, per-letter hole test) are written up in `docs/development/ENGINE_CONTRIBUTIONS.md` in engine-ready form.

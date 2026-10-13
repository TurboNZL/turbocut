# TurboEngine in TurboCut

TurboCut is pinned to `TurboNZL/turboengine` (`.turboengine.json`). The engine is a reference, not a dependency: this file says what TurboCut took from each module, where it lives here, and what it did differently.

| Module | Used | Where in TurboCut | Difference |
|---|---|---|---|
| `release-pipeline` | yes, adapted | `.github/workflows/build.yml` | Version `vYYYY.M.N` and lowercase asset names as the engine says. Also builds `claude/**` branches as pre-releases (the owner tests every branch on a phone) and attaches a web bundle. No `auto-pr.yml`. `ci.yml` replaces `check.yml` and runs on every push. |
| `updaters` | yes, adapted | `src/app/updater.ts`, `electron/main.cjs` (`setupUpdater`), `electron/preload.cjs`, Settings → Updates | Vanilla TypeScript. Uses the newest release including pre-releases, skips drafts; electron-updater for the installer and AppImage; the .deb and portable build point at the download; Android opens the APK. Not copied: the polkit/systemd .deb installer and the native Kotlin Android updater (TurboCut's APK opens in the browser's download). |
| `appearance` | followed as conventions | `src/app/main.ts` (engine start), `src/app/styles.css`, Settings → General (picker) | No React, no Tailwind. `turbothemes/base.css` first, tokens only, hook classes. Layouts are the app's own (`src/app/layout.ts`). Dependency still on the retired turbothemes repository (see below). |
| `guides-and-docs` | yes | `docs/guides/*.md` bundled by `src/app/guides.ts`, rendered by `src/app/markdown.ts`; `PROJECT_BRIEF.md`; `CLAUDE.md` | Guides show in Settings → Guides, on the home screen, and in a dialog. A safe renderer (text only, no HTML). |
| `settings-shell` | conventions | `src/app/settingsDialog.ts` | Tabs are the engine's token-only tab recipe (`.tab`), panels are `.card.bt-panel`. |
| `editions`, `window-frame`, `android-shell` | no | | One edition; the native window; a plain Capacitor shell. |

## UI structure (from the engine's INTEGRATION.md and audit)
- Dialog title is an `h2` in a flex `.bt-titlebar` (`dom.ts` `dialog`).
- Settings panels are `section.card.bt-panel` with an `h2.bt-panel-title` first (`dom.ts` `panel`).
- In-page tabs are `.tabs`/`.tab` with `role="tablist"`/`"tab"` and `aria-selected`; never `.bt-tab`/`.bt-tabbar` (those are the phone bottom bar).
- Icons are SVG in `currentColor` (the snapping magnet), not emoji.
- e2e selectors use `getByRole('tab')` for tabs.

## Not yet done
- **turbothemes source.** The engine moved the package to `turboengine/themes` and retired the old repository. TurboCut still installs `git+https://github.com/TurboNZL/turbothemes.git`. To switch: set the dependency to `git+https://github.com/TurboNZL/turboengine.git#path:/themes`, run `pnpm install --ignore-scripts`, then `pnpm e2e`. It was not done from the cloud session because the install fetches code from a second repository and needed the owner's go-ahead.
- `examples/verify-looks.mjs` (engine) has not been run against TurboCut after the structure fixes; the e2e suites and screenshots were.

## Taking improvements back
Things TurboCut learned that other apps could use (APK signing and install, release naming with a web bundle, safe Markdown renderer, font manager, layout manager, per-letter hole test) are written up in `docs/development/ENGINE_CONTRIBUTIONS.md` in engine-ready form.

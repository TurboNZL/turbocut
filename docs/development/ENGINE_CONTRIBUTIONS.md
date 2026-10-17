# What TurboCut learned that TurboEngine should have

Written in engine-ready form: each section says where it would go (`modules/<name>/MODULE.md` plus `files/`, or a doc), what it is, and the gotchas. Source: TurboCut at the commit that added this file. Nothing here is in the engine yet.

## 1. `android-apk`: ship an APK without a store (new module, recommended for every app with an Android build)

### What a test APK needs
- A **fixed signing key** committed to the repo (the standard debug keystore: alias `androiddebugkey`, passwords `android`). With it every build installs over the previous one and CI needs no secrets. It is public on purpose; anyone can build an APK that installs over yours, which is acceptable for test builds and not for a store.
- A **versionCode that only grows**, because Android refuses an install whose `versionCode` is not higher. TurboCut derives it from the release number: `(YYYY - 2000) * 1000000 + month * 10000 + update` (2026.10.5 gives 26100005). It stays below Android's limit of 2,100,000,000 until 2099 and survives the counter restarting each month.
- `versionName` = the release version, passed from CI (`-PtcVersionCode`, `-PtcVersionName`).
- A stable `applicationId` (never change it: a different id is a different app).

### CI recipe (GitHub Actions, ubuntu)
`actions/setup-java` (Temurin 21), `android-actions/setup-android` with `platform-tools platforms;android-36 build-tools;36.0.0`, `gradle/actions/setup-gradle`, then `./gradlew assembleDebug --no-daemon -PtcVersionCode=… -PtcVersionName=…` and copy `app/build/outputs/apk/debug/app-debug.apk` to `<app>-<version>-android.apk`. For a Capacitor app run `pnpm build && pnpm exec cap sync android` first. Attach the APK **as a plain release asset, never inside a zip** (the owner measured a zip doubling the download time on a phone).

### Checks worth running on the artifact
`apksigner verify --print-certs app.apk` (same certificate digest on every build), `aapt2 dump badging app.apk` (package, versionCode, minSdkVersion), `ls -l` (a Capacitor shell with a small web app is about 13 MB).

### Install flow for people (this text is also a user guide in TurboCut: `docs/guides/ANDROID_APK.md`)
Download the file, open it, allow "install unknown apps" for the app that opened it once (Settings → Apps → Special app access → Install unknown apps), tolerate Play Protect's "unrecognised app" prompt, install. Updates install over the old app and keep its data. "App not installed" almost always means an APK signed with a different key is already installed (uninstall first; app data is lost) or the download is incomplete.

### Gotchas
- A WebView app encodes video with the **phone's own** WebCodecs encoders: H.264/AAC support differs per device. Ship a device-check report people can copy (TurboCut: Settings → Device).
- The Android WebView ignores `<a download>`: write the file to the cache directory with `@capacitor/filesystem` in chunks (a multiple of 3 bytes per chunk keeps each base64 piece unpadded) and open the share sheet with `@capacitor/share`.
- An in-app updater on Android can only open the APK for the system installer; it cannot install silently without device-owner rights.
- Before a store release: a private release key (keep it, losing it means a new app id), an app bundle (AAB), and `minifyEnabled` decisions. That is a deliberate step, not a setting.

## 2. `release-pipeline` additions
- **One workflow** can build APK, desktop installers and a web bundle in parallel jobs, hand them over as artifacts (retention 1 day) and have one final job create the release with every file attached (`gh release create vX files/*`). Pick the version in the first job from the existing release tags (`gh release list --json tagName`), so every push gets the next number.
- Branch builds publish **pre-releases**; main publishes normal ones. The updater must list `/releases` (not `/releases/latest`) so pre-releases count.
- Lowercase asset names: set `artifactName` in electron-builder, name the APK in the copy step.
- Keep the newest N releases and delete the rest with `--cleanup-tag`.
- Do not use `paths-ignore` for docs if the docs are bundled into the app (TurboCut bundles `docs/guides`, so a guide edit should release; its current `paths-ignore: ['docs/**', '*.md']` is a known trade-off, say so in the app's notes).

## 3. `web-bundle` (new, optional): a web server instead of a desktop app
`scripts/serve.mjs` (zero dependencies, about 100 lines): static files with correct MIME types (`application/wasm` matters), a path-traversal guard, 404 for the rest, optional `--https` with a self-signed certificate made with the `openssl` command and kept in `~/.<app>/serve` so the browser's exception sticks, and a printed list of LAN addresses. Ship it in `<app>-<version>-web.zip` next to the built `app/` folder. **Why https:** WebCodecs, WebGPU, service workers and the clipboard API need a secure context; http on `localhost` counts, http on a LAN address does not. Tested with curl (200, traversal 404); a second device accepting the certificate was not tried.

## 4. `font-manager` (new, optional; vanilla TypeScript, IndexedDB)
Files: `src/app/fonts.ts`, `src/app/fontManager.ts`. Add (replacing a font with the same family), list with a preview drawn in the font, where it is used, make default, remove (with a warning if used), and a "missing on this device" list from `fontAvailable()` (compares canvas text widths against monospace, serif and sans-serif fallbacks). Gotchas: `FontFace.family` can come back quoted, strip the quotes before comparing; removing from `document.fonts` is not enough, delete the IndexedDB record too (the e2e removes, reloads and checks); store family names from the font's `name` table (IDs 1, 4, 16) so styles asking for any of them find the file; never commit font files, generate a tiny test font in CI with `fonttools` (subset a freely redistributable font and rename its family).

## 5. `layout-manager` (new, optional)
Files: `src/app/layout.ts` (pure: types, built-ins, `cleanLayout` that repairs any input, import/export), `src/app/layoutManager.ts` (Settings page), CSS keyed on `#app[data-panel]` and `[data-density]`. A layout is data: panel side (auto/right/left/sheet), panel width, timeline height, control size, tab order and visibility. Built-ins are read-only; "Duplicate to edit" copies. A narrow window forces the bottom sheet, listening to `matchMedia` changes. Gotcha found by the e2e: the editor must mutate the layout **in place** (`Object.assign`), because the controls on the page hold a reference to the object; replacing it in the list made every edit after the first vanish.

## 6. `guides-and-docs` additions
A dependency-free, **text-only** Markdown renderer for bundled guides (`src/app/markdown.ts`): headings, paragraphs, lists, tables, fenced code, bold, italic, code, links. Everything is inserted with `textContent`; only `https://` links and `OTHER.md` guide links stay links, anything else (`javascript:`, `data:`) becomes plain text. The e2e feeds it `<script>`, `<img onerror>`, a `javascript:` link and a table cell with HTML and checks that nothing runs or becomes an element. `import.meta.glob('docs/guides/*.md', { query: '?raw', eager: true })` bundles the files; a title table orders them.

## 7. A home screen instead of a hosted landing page
Apps with downloads need somewhere to explain them, and GitHub Pages is not free for private repositories. Put it in the app: start a project, update status, a download list built from the newest release's assets (skip the update manifests), install help linking the guides, a "don't show again" setting, and a Home button. For e2e, start every browser context with it switched off (an init script that sets the setting only if none is stored, so reloads keep what a test saved) and give the home test an opt-in.

## 8. Gotchas and test lessons
- **Measure what you claim.** The letter-hole test first counted pixels with alpha below 200, which includes the anti-aliased outer edge, so it reported holes that were not there. Count enclosed pixels with alpha below 8. Always run a new test against the old code first (the old code left clear pixels in o, g, 8, b, d, p and q; the new code left none).
- A fill style that only reaches "within the outline width of the ink" leaves the middle of wide holes open: "filled" must paint the whole enclosed region.
- `pnpm` with a `github:` dependency records an SSH address in the lockfile that CI cannot clone: use `git+https://…`.
- Canvas `filter: blur()` ignores the canvas transform: convert project pixels to device pixels with the base transform, and keep the preview-vs-export test threshold tight.
- Playwright: after turning in-page tabs into `role="tab"`, `getByRole('button', …)` stops finding them; a dialog's `Export` button and the editor's can share a name, so scope to the dialog.
- Chromium's synthesized scroll and pinch gestures do not work in headless runs; send paced raw touch events.
- Electron on Linux has no AAC encoder: bundle a WebAssembly AAC encoder fallback, choose the container from the video codec.
- Releases exist (and updaters see them) minutes before their assets: treat "release without manifest" as "still building".

## 9. Done: the .deb installer and the cut emblem
The vanilla CommonJS .deb updater (`electron/updater.cjs`, `electron/debInstall.cjs`) and the `cut` emblem are already in the engine (`modules/updaters/variants/vanilla-electron`, `modules/logos`, engine commit `4b4264b`). Also learned here: a 60 fps default frame rate makes every "seconds to frames" test constant change (a 3 s text layer is 180 frames, a 6 s export is 360); and merging a dopesheet under the inspector means e2e must scroll it into view before dragging.

## 10. `system-fonts` (done, 2026-10-17, now in the engine as `modules/system-fonts`)
`src/app/systemFonts.ts`: installed fonts via `queryLocalFonts()` with a well-known-names fallback; no imports, never throws. Measured in a real Electron 44.7 (Chromium 152, Xvfb): the call works with no permission handler and no user gesture. TurboDocs asked for it. The font manager's "Installed on this device" panel and `fontChoices()` (the one list every font box uses) are TurboCut's own and stay here.

## 11. Things learned in the 2026-10-17 pass that other apps may want
- **A side panel that floats**: mark the panel `bt-shell` (it is a side bar) and Liquid Glass, Spotify and One UI draw it rounded with a gap; those looks only leave the gap on the left, top and bottom, so an app whose panel is on the right or at the bottom adds the missing margin and widens its column by the gap (`styles.css`, "floating"). A theme variable for the gap (`--float-gap` is documented in `modules/layouts` but no style defines it) would remove the app CSS.
- **Never rebuild a panel for a change it already shows.** A dopesheet that tore down and rebuilt its whole card on every key change flickered, and in looks whose elements animate on insertion would replay that animation. Compare a signature of what is drawn (`keysPanel.ts` `signature`) and skip the rebuild, and do not `replaceChildren` with the node that is already there (`showTab`).
- **Selection is one thing.** Two independent selection fields (clip and caption) made Delete remove the wrong one and left a highlight no click could clear. Keep one selection, clear it on an empty press and on Escape.
- **Split follows the selection or the active track**, not "everything under the playhead": the unexpected cut of a track you were not looking at is worse than one extra click.
- **Symbol characters are emoji on many systems** (`⏮ ⏸ ⚙`): draw icons as inline SVG in `currentColor` (`src/app/icons.ts`).

## 12. Vanilla port of `motion`, symbol-only favicons, project files
- `src/app/motion.css` is the engine's `motion.css` classes for a non-React app, plus `tk-fade`; replaying an animation needs `classList.remove; void el.offsetWidth; classList.add`. Gotcha: a `ResizeObserver` callback that rebuilds DOM and changes the observer's own height logs "ResizeObserver loop completed with undelivered notifications"; compare the width and rebuild in `requestAnimationFrame`.
- A project-file format (`format` + `version`, validate every part, media referenced by name and size, relink dialog) could become a shared module for apps that edit documents on top of media.
- One global rule gives every pressable element `cursor: pointer` (and `not-allowed` when disabled); the theme's `.btn` did not. It could live in turbothemes `base.css`.

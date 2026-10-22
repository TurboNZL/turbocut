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
- Superseded: branch builds used to publish pre-releases. Now only main publishes, and a PR's build is reused on merge (engine module `prebuilt-release`).
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

## 2026-10-17 contributions (added to the engine)
- `prebuilt-release`: PR builds reused on merge (tree hash + next version check), tested with a fake gh/git.
- `updaters`: Capacitor `ApkUpdaterPlugin.java` (in-app APK download with progress).
- `system-fonts` (earlier, merged).
- Ideas not yet in the engine: the dock layout and layout presets with an automatic Custom copy (`layout.ts`, `layoutStore.ts`, `dock.ts`), a themed font picker (`fontPicker.ts`), per-setting keyframe lanes (`inspector.ts`), settings search (`settingsDialog.ts` `filterPage`).

## 5. Added 2026-10-17 (ready to port; each has tests in TurboCut)
- **`themed-select`** (`src/app/themedSelect.ts` + the `.themed-select` block of `styles.css`): vanilla version of TurboKeep's `Select.tsx`. Upgrades every `select.input` in place (the native `<select>` stays, hidden, as the source of truth, so `.value`, rebuilt options and `change` listeners keep working); a `bt-menu` list with keyboard, a search box above 12 options and a check on the chosen row. Gotchas: a `<button>` does not inherit the field colour (give it `color: hsl(var(--fg))`); position the list with `offsetHeight` not `getBoundingClientRect` (the opening animation scales it); leave room for `--dock-h`; Playwright's `selectOption` cannot reach the hidden select, use a helper that opens the list and presses the row (`pick()` in `e2e/browser.mjs`). Also: `.input` sets no `color`, so a field's text followed the browser's dark/light guess and came out white on a light look; set `input.input { color: hsl(var(--fg)) }` (belongs in `turbothemes` base).
- **`device-share`** (`electron/share.cjs`, `src/app/share.ts`, `test/share.test.ts`): find other copies of an app on the same network (UDP broadcast on the share port every 3 s, entries expire after 10 s) and send a project to one. Sender asks (`POST /offer`), the receiver's person presses Accept, then project, media and fonts stream as separate `PUT /part/<transfer>/<kind>` requests and `POST /done/<transfer>` closes it. Rules worth keeping: only private/loopback/link-local addresses are answered, nothing is written before Accept, each transfer is capped at the size that was offered, file names are reduced to a base name, received folders are swept after a day. The page cannot listen or broadcast, so a browser and the Android WebView cannot take part (an Android plugin using `NsdManager` would be the way). A page cannot `fetch` an `http://` LAN address from a secure origin (mixed content): the Electron main process makes the requests and the page streams chunks to it over IPC. Port 47903 (TCP and UDP) is in `docs/PORTS.md`. Not run between two real computers.
- **`twitch-clips`** (`src/twitch/clip.ts`, `electron/twitch.cjs`, `src/app/twitchDialog.ts`, `test/twitch.test.ts`): paste a clip link, get the landscape MP4. The persisted query `ShareClipRenderStatus` on `gql.twitch.tv` returns `assets[]` (first is landscape, second portrait) with `videoQualities[{quality, frameRate, sourceURL}]` and a `playbackAccessToken`; the MP4 is `sourceURL` plus `sig` and `token`. Client id and hash are yt-dlp's (`twitch.py`, `TwitchClipsIE`); when it stops working compare with that file. Page code is for the browser (CORS may refuse it), the `.cjs` twin for Electron's main process. Never run against live Twitch from the sandbox (its proxy blocks it).
- **`recent-projects`** (`src/app/recent.ts`): a copy of the edit under the project's name in IndexedDB (save, open, and 4 s after the last change), newest first, at most 12. The home screen lists them. Opening asks for the media again.
- **Layout with named divisions** (TurboCut `layout.ts`, `panelHost.ts`, `layoutManager.ts`): a layout is a list of `{name, side, tabs, size}`; left and right columns; a phone merges them into one sheet that keeps the timeline visible. The dock is an app setting with three pages (Home, Edit, Settings), not a layout.
- **Home screen as two snapping screens** (`home.ts`, `.home { scroll-snap-type: y mandatory }`, `.home-page { flex: 0 0 100% }`): what you start with first, the rest below the edge.
- **Cancel that cancels**: race the work against the abort signal and reset the UI at once; also pass the signal into the long loops (`renderPcm16k`) and check `signal.aborted` before listening for an `abort` event (an already-aborted signal never fires it).
- **Frame-stride playback** (`MediaLibrary.sequential(p, start, stride)`): a lower preview frame rate decodes only every stride-th frame instead of decoding all and drawing some.

## 6. Added 2026-10-20 (ready to port)
- **Touch-aware preview defaults** (`player.ts` `previewStride`, `PREVIEW_MAX_TOUCH`): automatic preview is 640 px and 30 draws a second on a coarse pointer; the inspector does not refresh per frame during playback on a phone.
- **Dialog padding for rounded looks** (`.dlg { --dlg-pad }` in `styles.css`): body and footer padding follow `--win-r`; the footer rule sits in `:where()` so a look's own footer still wins.
- **Window frame backing** (`.bt-wf::before` plus the shell's `setBackgroundColor` following `--bg`): a look whose title bar is transparent no longer shows the dark window colour as a bar. Not run in real Electron here.
- **Tool bar positions** (`ToolsPlacement` `row`, `left`, `right`) and `@container stage` rules that wrap the bar when the stage is narrow.

## 7. Added 2026-10-22 (ready to port)
- **Warm start and decoder prefetch for preview playback** (`player.ts`, `SequentialFrames.prefetch` in `library.ts`) with the simulated slow-decoder test `e2e/playback-smooth.mjs`: warm decoders and the first sound window before the clock starts; open the next clip's decoder before the cut.
- **Refuse undecodable video at import** (`MediaLibrary.checkPicture`) and the Twitch version step-down (`ResolvedClip.sources`).

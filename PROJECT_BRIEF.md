# TurboCut: project brief

The long-lived "why and what". `CLAUDE.md` is the running log; this file changes rarely.

## Goal and user
A lightweight, cross-platform multi-track video editor with built-in automatic captions, for one person who makes shorts (9:16, under a minute) mostly on an Android phone and also edits 16:9 videos up to about twenty minutes on Windows and Ubuntu. Low friction beats high detail.

## Feature inventory
- Multi-track video and audio timeline, linked picture and sound, media bin, snapping, waveforms, text layers, keyframes on every setting (including volume, blur, pixelate).
- Captions: local Whisper on WebGPU (no remote server any more); presets (styles) with variants, bounce entrance that matches the original `ass_bounce.py`, filled letter holes by default, fonts bundled in style files.
- Touch-first: fixed centre playhead, big trim handles, pinch zoom.
- Settings dialog, remappable shortcuts, editor layouts (panel side and size, control size, tabs), font manager, themes from turbothemes, guides, home screen.
- Export to MP4 (H.264 + AAC) or WebM (VP9/AV1 + Opus) in the app, no upload.
- Ships as an Android APK, Windows installer and portable, Linux AppImage and .deb, a web bundle with its own server, and the web app itself.
- Self-update from GitHub Releases, including the Linux .deb (password prompt or terminal fallback); versions Year.Month.Update.
- 60 fps default frame rate; the engine logo family (`logos` module).

## Rules that must not be broken
1. Machine identifiers lowercase, the product is styled TurboCut.
2. No platform-specific app code: one TypeScript web app, wrapped.
3. Time is integer frames; the core is pure and unit tested.
4. Never commit font files. Never hard-code colours, radii or fonts in app CSS (themes own them); video content surfaces excepted.
5. Letter-hole style "filled" paints every hole solid (tested per letter with the real font).
6. Preview must match export (tight threshold in `pnpm e2e`).
7. Assets are plain files with lowercase names; no zips except the web bundle.
8. No pull request unless the owner asks; no GitHub Pages (the owner does not want a paid hosting dependency): the home screen is in the app.

## Architecture
See `docs/ARCHITECTURE.md` (pipeline, app, unverified items) and `docs/development/ENGINE.md` (which turboengine modules are used and where they live).

## Roadmap (with done-criteria)
| Item | Done when |
|---|---|
| Twitch clip import | Paste a clip URL, the clip lands in the bin; resolver tested against a live clip |
| On-device Whisper proven | A real caption run on the owner's phone produces correct words (needs the model download; the cloud sandbox cannot reach Hugging Face) |
| Release signing | A private release key and an app bundle for a store build (today: public debug key on purpose) |

## Glossary
- **Style / preset**: a caption look pack (variants plus an entrance), a JSON file.
- **Variant**: one look inside a style (for example the red one).
- **Layout**: where the editor puts its panel and how big things are; not a theme.
- **Letter holes (counters)**: the inside of o, e, a, g.
- **Clip tab**: the selected clip's settings with its keyframe dopesheet underneath.
- **Emblem**: the app's own symbol on the engine logo (TurboCut: a play triangle cut by a blade).

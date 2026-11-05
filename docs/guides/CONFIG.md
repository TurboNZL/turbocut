# Settings files (config)

**Settings → Config** moves your settings between devices, or keeps a backup of them. A config is a small file (`turbocut.conf`) that holds settings, nothing else: no projects, no media.

## Export a config
The page lists **only the settings that differ from the defaults**, each with a tick box, grouped by where it lives (General, Look, Layout, Keys and so on). That is also a good way to find a setting you changed long ago and forgot about.
- **Untick** any setting you do not want in the file.
- **Preview the file** shows exactly what will be saved; it changes as you tick and untick.
- **Save config file** downloads it, **Copy** puts the text on the clipboard.
- **Apply this config to this instance** makes this device use exactly the ticked settings. Everything you unticked goes back to its default, and TurboCut lists those first so nothing is a surprise. This is how you clear out settings you forgot about without hunting for them one by one.

## Import a config
**Choose a config file…** reads the file and shows **what would change** (`now → new`) before anything is applied. Untick the ones you do not want, then press **Apply**. Settings the file does not mention are left as they are, your own layouts are kept unless the file has one with the same name, and a value that does not make sense (a hand-edited file, a newer version) is ignored instead of trusted. The older *Export settings* file still opens here.

## What is in a config
Everything under Settings that is a choice: snapping, waveforms, the order of the timeline rows, preview sharpness and rate, the home screen, saving, the dock, the layout and your own layouts, the default font and letter holes, the caption language and model, shortcuts you changed, and the device name. Caption styles, fonts and projects are not part of it (share those from their own pages).

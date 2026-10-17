# Saving and opening projects

A project is a file ending in **.turbocut**. It holds the edit (cuts, text, keyframes, caption text, the size and frame rate), **not the video**: the media stays where it is, so the file is small and easy to back up or send.

## Save
**File → Save project** (or **Ctrl+S**). On a computer the file goes to your downloads; on Android the share sheet opens so you can put it in Files, Drive or anywhere else. The name is the project name from the Project tab.

## Open
**File → Open project…** (or **Ctrl+O**), *Open project…* on the Home screen, or drop a `.turbocut` file on the window.

The first time a project is opened on a device, TurboCut asks for its media: **Find the media** lists the files it needs. Pick them (several at once is fine) and they are matched by **file name**, and by size when two files share a name. Drop the files on the window to do the same. Until a file is found its clips stay on the timeline but show no picture. **File → Find missing media…** reopens the list.

## Recent projects
The Home screen lists your **recent projects**. TurboCut keeps a copy of the edit (never the video) on this device whenever you save, open or change a project, a few seconds after the last change, so even work you never saved to a file is one tap away. Opening one asks for its media like opening a file does. The × beside a project takes it off the list. Home → *Open a project* only closes the Home screen when a project was really opened: backing out of the file picker leaves you on Home.

## Send a project to another device
**File → Send to another device…** (desktop apps, Windows and Linux). TurboCut finds the other TurboCut apps on the same network by itself and lists them; choose one, choose whether to include the **media files** and the **fonts** (and the caption style comes along), and press Send. The other app asks its person to **Accept** first; nothing is saved there until they do. It then opens the project and asks for nothing, because the media came with it (without media it asks for the files like any project). Turn it off, or rename the device, in Settings → Device. It uses port 47903 on your network; a firewall may ask about it once. The Android app and the browser version cannot receive or send directly yet: save the file and move it across.

## New project, and unsaved changes
**File → New project** (or **Ctrl+N**) starts an empty project at the same size. If there are changes you have not saved, TurboCut asks first: save, discard or cancel.

## Good to know
- The file stores times as whole frames of the project's frame rate (60 fps by default), so it opens exactly the same everywhere.
- Fonts used by text layers and captions are not inside the project file. Add the same fonts on the other device (Settings → Fonts), otherwise a fallback font is drawn.
- A project saved by a newer TurboCut than yours says so instead of opening wrongly. Update the app and try again.

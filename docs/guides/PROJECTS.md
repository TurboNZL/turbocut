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
**File → Send to another device…** (desktop apps, Windows and Linux). Choose what goes with the project: the **video files**, the **fonts** (the caption style always comes along), and, when the project has Twitch clips, whether they go as **links**. Twitch clips travel as a link by default: the other device downloads the clip itself, which is far less to send and lets that device pick a version it can play. One button does the rest.

- **To another computer:** TurboCut finds the other TurboCut apps on the same network by itself and lists them; press Send. The other app asks its person to **Accept** first; nothing is saved there until they do. It then opens the project and asks for nothing, because everything came with it.
- **To a phone (or any device that cannot be found on the network):** press **Send with a code**. The computer shows its **address** and a six-digit **code**. On the phone open TurboCut and choose **From a computer** on the Home screen (or **File → Receive from a computer…**), type the address and the code, and press Receive. The project, fonts, caption style and videos arrive, and any Twitch clips download on the phone. The phone remembers the address, so next time only the code is needed. The code works for 20 minutes, closes after one successful transfer, and closes if ten wrong codes are tried.

Both devices must be on the same Wi-Fi. Turn sharing off, or rename the device, in Settings → Device. It uses port 47903 on your network; a firewall may ask about it once. The browser version can neither send nor receive (a web page opened over https is not allowed to reach another device on the network): save the file and move it across, or use the app.

## Twitch clips come back by themselves
A media entry that was imported from a Twitch link remembers the link inside the project file. Open that project on another device (from a file, from Home, or received from another computer) and **Find the media** offers **Download the Twitch clip**; a project received from another TurboCut downloads them straight away. Because the other device may not be able to play the best version (many cannot play HEVC), TurboCut steps down to a smaller version until one opens.

## New project, and unsaved changes
**File → New project** (or **Ctrl+N**) starts an empty project at the same size. If there are changes you have not saved, TurboCut asks first: save, discard or cancel.

## Good to know
- The file stores times as whole frames of the project's frame rate (60 fps by default), so it opens exactly the same everywhere.
- Fonts used by text layers and captions are not inside the project file. Add the same fonts on the other device (Settings → Fonts), otherwise a fallback font is drawn.
- A project saved by a newer TurboCut than yours says so instead of opening wrongly. Update the app and try again.

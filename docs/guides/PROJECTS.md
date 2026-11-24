# Saving and opening projects

A project is a file, and there are three kinds. The save window's **file type** list (or, where there is none, a short window) is where you choose; the **full project is offered first**, so it is what a plain Save makes.

| File | What is inside |
| --- | --- |
| **.turbocutf** (full) | The edit **and** everything the project uses that another device may not have: the video and audio files, the fonts you added, and your caption style. Opens anywhere with nothing to find. Can be large. |
| **.turbocut** (edit only) | The edit alone (cuts, text, keyframes, caption text, size, frame rate). Small; the media stays where it is. |
| **.turbocutc** (edit with its clips) | The edit plus the clips that were fetched from a link, so they need not be downloaded again. No other media, fonts or styles. |

The name of the file is shown **next to the File menu** (**Unsaved project** until it has been saved; a dot after the name means there are changes since the last save).

## Save
**File → Save project** (or **Ctrl+S**). The first time, TurboCut asks **where to put the file** and what to call it (the project name is suggested). After that, Save writes to the same file, and **File → Save project as…** (**Ctrl+Shift+S**) puts a copy somewhere else.
- **Windows and Linux app:** the system's own save window. It **starts in the folder you used last** (not your home folder), and the first time in the folder new projects go to (see *The project manager* below).
- **A browser with file access (Chrome, Edge):** the browser's save window. It remembers the file, so Save keeps writing to it; it may ask permission again after you reopen the page.
- **Android:** the file goes to TurboCut's own storage on the phone by default, or to **Documents/TurboCut** if you choose that in the project manager (a second project with the same name gets a number, nothing is overwritten). If the phone does not allow that, the share sheet opens instead.
- **Other browsers (Firefox, Safari):** they cannot keep a file open, so Save downloads a new copy each time.

**Autosave.** Once a project has a **.turbocut** file, TurboCut writes your changes to it a few seconds after you make them (Settings → General → Saving turns it off). A **.turbocutf** or **.turbocutc** is *not* autosaved, because that would rewrite every video each time: press Save (Ctrl+S) when you want it brought up to date; the dot beside the name tells you it is behind. A project that has never been saved is **not** kept anywhere: TurboCut asks before it would be lost (a new project, opening another one, closing the window). Only media that is open can go inside a full project; the message after saving says if some was not.

## The project manager
**File → Projects…** (or **Projects** on the Home screen, or Settings → General → Projects) lists every project TurboCut keeps in its project folders, newest first, with its kind, size and folder. Press a project to open it; each row can also show it in its folder (computer), **rename** it or **delete** it (on a computer a deleted project goes to the bin; elsewhere it is deleted for good, and the manager asks first). The search box filters the list, and **Open a file…** is the usual file picker for a project somewhere else.

**Folders.** There is always one default folder, platform dependent:
- **Windows and Linux app:** TurboCut's app-data folder (`Projects` inside TurboCut's settings folder: `%APPDATA%\TurboCut` on Windows, `~/.config/TurboCut` on Linux).
- **Android:** TurboCut's own storage. **Documents/TurboCut** is the *personal files* folder: other apps and a computer can see it, and TurboCut reads it too.
- **A browser:** the browser's private storage for this site (what another device sends lands here). The browser's own save window still saves wherever you choose.

On a computer, **Add a folder…** adds a personal folder (Documents, a synced folder, a drive); TurboCut reads the projects in it too. The round button **marks where new projects are saved**: the default folder or one of yours. A folder that is gone (a drive that is not connected) stays in the list, marked, until you remove it; removing a folder only stops TurboCut reading it, the files stay.

## Open
**File → Projects…** (the manager above), **File → Open project…** (or **Ctrl+O**, a file picker that also starts in the last folder you used), *Projects* on the Home screen, a project in the recent list, or drop a project file (`.turbocutf`, `.turbocut` or `.turbocutc`) on the window. A project you open that way remembers its file, so Save writes back to it.

**Media.** A full project brings its own videos. For the other kinds, the **media bin remembers where each file is**, behind the scenes. The **Windows and Linux app remembers the real path of each video on the computer** and opens it again by itself when you open the project, also after going out of a project and back in. Android and browsers are never told a file's location, so there TurboCut keeps **a copy of what you import in its own private storage** (Settings → General → Media: on by default, up to 4 GB, the oldest go first, and a button forgets them all) and looks there first. A file that cannot be found any other way is listed under **Find the media**, where you pick the files (several at once is fine); they are matched by **file name**, and by size when two files share a name: **Find the media** lists what it needs, you pick them (several at once is fine), and they are matched by **file name**, and by size when two files share a name. Drop the files on the window to do the same. Until a file is found its clips stay on the timeline but show no picture. **File → Find missing media…** reopens the list.

## Recent projects
The Home screen lists the project **files** you saved or opened lately, with where each one is. It is only a list of places: TurboCut does not keep a second copy of your edit. Opening one reads that file; if it was moved or deleted TurboCut says so and takes it off the list. The × beside a project removes it from the list (the file stays where it is). Home → *Projects* only closes the Home screen when a project was really opened: closing the manager leaves you on Home.

## Send a project to another device
**File → Send to another device…** (desktop apps, Windows and Linux). What is sent is **one project file** (a full `.turbocutf`: the edit, the caption style and, as you choose, the **video files** and the **fonts**; when the project has Twitch clips, whether they go as **links**). The other device keeps that file in its **Projects** and opens it from there, so it is still on the device the next time. Twitch clips travel as a link by default: the other device downloads the clip itself, which is far less to send and lets that device pick a version it can play. One button does the rest.

- **To another computer:** TurboCut finds the other TurboCut apps on the same network by itself and lists them; press Send. The other app asks its person to **Accept** first; nothing is saved there until they do. It files the project in its **Projects** folder and opens it, and asks for nothing, because everything came with it.
- **To a phone (or any device that cannot be found on the network):** the **first time**, press **Get a link for a phone**, then **Copy link**, and send the link to yourself any way you like (a chat, a note). On the phone open TurboCut, choose **Send or receive** on the Home screen (or **File → Receive from another device…**), paste the link and press Receive. The project file arrives (with its videos, fonts and caption style inside), is kept in the phone's **Projects**, and opens; any Twitch clips download on the phone. The link works once and for an hour; it is long and random, so nobody on the network can guess it.
- **Every time after that, no link and nothing to open.** When a transfer finishes, the phone remembers the computer's address and the computer remembers the phone (by a secret key the phone made; only a hash of it is kept). From then on, press **Send** next to the phone's name on the computer and the phone, with TurboCut open, asks *Save it to your projects?* Tap **Yes**. **Forget** on either side removes the other. If the computer's address changed (a new router lease), the phone cannot reach it: get a link once more. Between two computers nothing needs remembering: they already find each other.
- **From the phone back to the computer:** open **Send or receive** on the phone and press **Send** next to the computer. The computer asks to accept. In the project manager, the send button on a row opens that project and starts the same window.
- **A project needs a name** before it can be saved, sent or exported. Until you type one it is called what its file is called.

Both devices must be on the same Wi-Fi. Turn sharing off, or rename the device, in Settings → Device. It uses port 47903 on your network; a firewall may ask about it once. The browser version can neither send nor receive (a web page opened over https is not allowed to reach another device on the network): save the file and move it across, or use the app.

## Twitch clips come back by themselves
A media entry that was imported from a Twitch link remembers the link inside the project file. Open that project on another device (from a file, from Home, or received from another computer) and **Find the media** offers **Download the Twitch clip**; a project received from another TurboCut downloads them straight away. Because the other device may not be able to play the best version (many cannot play HEVC), TurboCut steps down to a smaller version until one opens.

## New project, and unsaved changes
**File → New project** (or **Ctrl+N**), or a shape on the Home screen, starts an empty project; nothing from the project before comes along. If the project before has changes that are not in a file, TurboCut asks first: **Save**, **Discard** or **Cancel** (Escape is Cancel).

## Good to know
- The file stores times as whole frames of the project's frame rate (60 fps by default), so it opens exactly the same everywhere.
- Fonts used by text layers and captions are not inside the project file. Add the same fonts on the other device (Settings → Fonts), otherwise a fallback font is drawn.
- A project saved by a newer TurboCut than yours says so instead of opening wrongly. Update the app and try again.

# Updates and versions

Versions are **Year.Month.Update**, for example `2026.10.3`: the third build of October 2026. The update number counts up within the month and every build gets the next one.

## How each version updates
| Version | How it updates |
|---|---|
| Windows installer, Linux AppImage | Settings → Updates → *Check for updates*; the app downloads the new version and restarts into it. |
| Linux .deb | Settings → Updates → *Download and restart*: the app downloads the package and asks for your password (a normal system prompt). If your desktop shows no prompt, a terminal window opens and asks instead. TurboCut restarts once the new version is installed. If neither works, the card shows the one command to copy: `sudo apt install ./file.deb`. |
| Windows portable | It cannot update itself: download the new file. |
| Android | The app downloads the new APK itself and opens Android's installer over the old one. See [Android APK](ANDROID_APK.md). |
| Web (including your own server) | Reload the page; the server always serves the newest copy you gave it. |

## Where updates come from
The public **Releases** page of the repository. The newest version number wins, not the newest date. Every release is a normal release made when a change is merged into `main`; if the pull request was already built, those same files are published. Only the five newest releases are kept.

Turn the automatic check off in Settings → General. *Check for updates* in Settings → Updates always works.

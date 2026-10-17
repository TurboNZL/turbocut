# Android: installing, updating and fixing the APK

TurboCut for Android is an **APK** file you download from the Releases page and install yourself. It is not in an app store.

## Install
1. Download `turbocut-<version>-android.apk` on the phone (the newest release). It is a plain file, not a zip.
2. Open it. Android asks you to **allow installing from this source** the first time: switch it on for the app you opened the file with (your browser or Files). On Android 8 and newer this is *Settings → Apps → Special app access → Install unknown apps*.
3. Confirm the install. Google Play Protect may say the app is not from the Play Store or "unrecognised". Choose *Install anyway*: it is a test build you downloaded on purpose.

Needs Android 7.0 (API 24) or newer. The app id is `com.turbonzl.turbocut`.

## Update
- **Inside the app:** Settings → Updates → *Check for updates*. If a newer release exists, *Download and install* downloads the APK inside the app (with a progress bar) and opens Android's installer. The first time, Android sends you to a page where you allow TurboCut to install apps; allow it, come back and press the button again. The new version installs **over** the old one and keeps your settings.
- Every build is signed with the same fixed key, which is why a new APK can replace the old one. Version numbers go up with every build (`versionCode` is derived from the release number), so Android accepts it as an update.
- Every release comes from `main` and is a normal release; there are no pre-releases.

## If it does not install
| Message or symptom | Cause and fix |
|---|---|
| "App not installed" | An APK signed with a different key is already on the phone (a build from somewhere else). Uninstall TurboCut and install again. Settings and fonts stored in the app are lost. |
| "App not installed as package appears to be invalid" | The download is incomplete. Download it again, on a stable connection. |
| Install button greyed out | "Install unknown apps" is off for the app you opened the file from. |
| Nothing happens when tapping the file | Open it from Files instead of the notification, or use another browser. |
| "Parse error" | The phone is older than Android 7.0. |

## What to know about the signing key
The key is the standard debug keystore, committed to the repository on purpose (`android/debug.keystore`), so every test build installs over the last one and CI needs no secrets. **It is public**: anyone could build an APK that installs over yours. That is fine for testing. Before a store release, switch to a private release key and an app bundle (AAB); that is a deliberate step, not a setting.

## Video support differs per phone
Export uses the phone's own encoders (WebCodecs in the Android WebView). Settings → Device → *Device check* lists which video and audio codecs this phone can encode, whether WebGPU is available (used for on-device captions) and how fast it encodes. Send that report when something fails to export.

## Saving files
Exports and style or layout files go through the Android share sheet: pick Files, Drive, or any app. Nothing is written to a shared folder without your choosing it.

# Export and codecs

TurboCut encodes in the app with the device's own encoders (WebCodecs). The container follows the video codec:

| Video | Audio | File |
|---|---|---|
| H.264 | AAC | MP4 (plays everywhere) |
| VP9 or AV1 | Opus | WebM |

If the device can encode H.264 it is used. Some platforms have no AAC encoder (Electron on Linux); TurboCut then uses a built-in WebAssembly AAC encoder, so MP4 still works.

## Sizes and length
Shorts (9:16, 1080×1920, under a minute) are the main case. 16:9 up to about twenty minutes works; audio is mixed in 30-second windows so a long edit does not need gigabytes of memory.

## If export fails or is slow
- Open Settings → Device → *Device check*, copy the report and send it. It shows which codecs this device can encode and how fast.
- Close other apps; export keeps the screen awake while it works.
- Very high-resolution or 10-bit sources are the usual cause of high memory use. Say the clip's resolution and codec when you report it.
- Preview uses a reduced size; the export is full size and looks the same (this is checked automatically).

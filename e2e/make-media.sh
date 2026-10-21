#!/bin/sh
# Creates the test sources used by `pnpm e2e` (VP9/Opus because open-source Chromium cannot decode H.264):
#   src.webm   6 s, 1080p test pattern + tone
#   chirp.webm 75 s, black video + a pitch sweep, so any shifted/gapped/repeated audio is obvious
set -e
dir="$(dirname "$0")/.media"
mkdir -p "$dir"
ffmpeg -loglevel error -y -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=6" -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=6" \
  -c:v libvpx-vp9 -b:v 3M -deadline realtime -cpu-used 8 -c:a libopus "$dir/src.webm"
ffmpeg -loglevel error -y -f lavfi -i "color=c=black:s=320x240:r=30:d=75" \
  -f lavfi -i "aevalsrc='0.5*sin(2*PI*(200*t + (2800/(2*75))*t*t))|0.5*sin(2*PI*(200*t + (2800/(2*75))*t*t))':s=48000:d=75" \
  -c:v libvpx-vp9 -b:v 200k -deadline realtime -cpu-used 8 -c:a libopus -b:a 128k "$dir/chirp.webm"
# vonly.webm: 4 s of video with no audio track at all (for multi-track picture tests)
ffmpeg -loglevel error -y -f lavfi -i "testsrc=size=640x360:rate=30:duration=4" -c:v libvpx-vp9 -b:v 500k -deadline realtime -cpu-used 8 -an "$dir/vonly.webm"
# h264.mp4: H.264 + AAC, the format of a Twitch clip. Open-source Chromium cannot decode it: the import test checks the message (skipped without libx264)
ffmpeg -loglevel error -y -f lavfi -i "testsrc=size=640x360:rate=60:duration=2" -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=2" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -shortest "$dir/h264.mp4" || echo "skipping h264.mp4 (needs libx264)"
# TurboTestFont.ttf: a tiny font with a made-up family name (a subset of DejaVu Sans, which is freely redistributable), for the style editor tests
python3 - "$dir/TurboTestFont.ttf" <<'PY' || echo "skipping TurboTestFont.ttf (needs python3 fonttools and DejaVu Sans)"
import sys
from fontTools import subset, ttLib
src = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
opts = subset.Options(); opts.name_IDs = ["*"]
font = subset.load_font(src, opts)
s = subset.Subsetter(opts); s.populate(text="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ")
s.subset(font)
for r in font["name"].names:
    if r.nameID in (1, 16): r.string = "Turbo Test Font"
    if r.nameID in (4, 6): r.string = "TurboTestFont"
font.save(sys.argv[1])
PY

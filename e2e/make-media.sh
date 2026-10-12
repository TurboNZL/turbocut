#!/bin/sh
# Creates the 6 s 1080p VP9/Opus test source used by `pnpm e2e` (VP9 because open-source Chromium cannot decode H.264).
mkdir -p "$(dirname "$0")/.media"
ffmpeg -loglevel error -y -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=6" -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=6" \
  -c:v libvpx-vp9 -b:v 3M -deadline realtime -cpu-used 8 -c:a libopus "$(dirname "$0")/.media/src.webm"

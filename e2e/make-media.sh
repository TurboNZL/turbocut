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

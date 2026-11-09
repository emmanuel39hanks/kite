#!/bin/sh
# Renders every clip to out/clips/<id>.mp4 (1920×1080, 60 fps, H.264), ready to drop into the edit.
set -e
cd "$(dirname "$0")/.."
mkdir -p out/clips
for id in 01-problem 02-your-account 03-earn 04-checks 05-daos 06-attack 07-leave 08-end; do
  npx remotion render src/index.ts "clip-$id" "out/clips/$id.mp4" --codec h264 --crf 16 --log=error
  echo "rendered out/clips/$id.mp4"
done

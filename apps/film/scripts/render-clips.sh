#!/bin/sh
# Renders every clip twice, from lossless PNG frames:
#   out/clips/<id>.mov  ProRes 422 HQ master for editing (visually lossless, large)
#   out/clips/<id>.mp4  H.264 at CRF 8, near-lossless, for quick viewing and direct upload
set -e
cd "$(dirname "$0")/.."
mkdir -p out/clips
for id in 01-problem 08-end; do
  npx remotion render src/index.ts "clip-$id" "out/clips/$id.mov" --codec prores --prores-profile hq --image-format png --log=error
  npx remotion render src/index.ts "clip-$id" "out/clips/$id.mp4" --codec h264 --crf 8 --pixel-format yuv420p --image-format png --x264-preset slow --log=error
  echo "rendered $id"
done

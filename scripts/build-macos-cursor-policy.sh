#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
source_file="$project_root/native/macos/WindowCursorPolicy.mm"
output_dir="$project_root/build/native/macos"
arm_binary="$output_dir/minuteframe-cursor-policy-arm64.node"
x64_binary="$output_dir/minuteframe-cursor-policy-x64.node"
output="$output_dir/minuteframe-cursor-policy.node"

mkdir -p "$output_dir"
for architecture in arm64 x86_64; do
  if [[ "$architecture" == arm64 ]]; then
    architecture_output="$arm_binary"
  else
    architecture_output="$x64_binary"
  fi
  xcrun --sdk macosx clang++ \
    -O2 \
    -std=c++20 \
    -fobjc-arc \
    -fblocks \
    -arch "$architecture" \
    -mmacosx-version-min=13.0 \
    -bundle \
    -undefined dynamic_lookup \
    -framework Foundation \
    -framework ScreenCaptureKit \
    "$source_file" \
    -o "$architecture_output"
done

lipo -create "$arm_binary" "$x64_binary" -output "$output"
rm "$arm_binary" "$x64_binary"
file "$output"

#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
source_file="$project_root/native/macos/SystemAudioCapture.swift"
output_dir="$project_root/build/native/macos"
arm_binary="$output_dir/minuteframe-audio-capture-arm64"
x64_binary="$output_dir/minuteframe-audio-capture-x64"
output="$output_dir/minuteframe-audio-capture"

mkdir -p "$output_dir"
xcrun --sdk macosx swiftc \
  -O \
  -target arm64-apple-macos13.0 \
  -framework AppKit \
  -framework AVFoundation \
  -framework CoreAudio \
  -framework CoreMedia \
  -framework ScreenCaptureKit \
  "$source_file" \
  -o "$arm_binary"
xcrun --sdk macosx swiftc \
  -O \
  -target x86_64-apple-macos13.0 \
  -framework AppKit \
  -framework AVFoundation \
  -framework CoreAudio \
  -framework CoreMedia \
  -framework ScreenCaptureKit \
  "$source_file" \
  -o "$x64_binary"
lipo -create "$arm_binary" "$x64_binary" -output "$output"
chmod +x "$output"
rm "$arm_binary" "$x64_binary"
file "$output"

#!/usr/bin/env bash
set -euo pipefail

app_path="${1:?Usage: verify-macos-bundle.sh /path/to/MinuteFrame.app}"
expected_identifier="com.minuteframe.app"

codesign --verify --deep --strict --verbose=2 "$app_path"

signature_details="$(codesign -dv --verbose=4 "$app_path" 2>&1)"
actual_identifier="$(printf '%s\n' "$signature_details" | awk -F= '/^Identifier=/{print $2}')"

if [[ "$actual_identifier" != "$expected_identifier" ]]; then
  printf 'Expected signing identifier %s, got %s\n' "$expected_identifier" "$actual_identifier" >&2
  exit 1
fi

if [[ "$signature_details" != *"Info.plist entries="* ]]; then
  printf 'Info.plist is not bound into the app signature.\n' >&2
  exit 1
fi

if [[ "$signature_details" != *"Sealed Resources version=2"* ]]; then
  printf 'App resources are not sealed by the signature.\n' >&2
  exit 1
fi

printf 'Verified macOS bundle signature: %s\n' "$app_path"

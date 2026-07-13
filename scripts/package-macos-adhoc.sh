#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -p "require('$project_root/package.json').version")"
staging_root="$(mktemp -d "${TMPDIR:-/tmp}/meeting-capture-package.XXXXXX")"
unsigned_app="$project_root/release/mac-universal/Meeting Capture.app"
signed_app="$staging_root/Meeting Capture.app"
dmg_root="$staging_root/dmg"
output="$project_root/release/Meeting-Capture-${version}-mac-universal.dmg"
mount_root="$staging_root/mount"
mounted=false

cleanup() {
  if [[ "$mounted" == true ]]; then
    hdiutil detach "$mount_root" >/dev/null
  fi
  rm -rf "$staging_root"
}
trap cleanup EXIT

cd "$project_root"
npm run build
npx electron-builder --mac --universal --dir --config.mac.identity=null

ditto --norsrc "$unsigned_app" "$signed_app"
codesign --force --deep --sign - --identifier com.meetingcapture.app "$signed_app"
"$project_root/scripts/verify-macos-bundle.sh" "$signed_app"

mkdir -p "$dmg_root"
ditto --norsrc "$signed_app" "$dmg_root/Meeting Capture.app"
ln -s /Applications "$dmg_root/Applications"
"$project_root/scripts/verify-macos-bundle.sh" "$dmg_root/Meeting Capture.app"

hdiutil create \
  -volname "Meeting Capture ${version}" \
  -srcfolder "$dmg_root" \
  -ov \
  -format UDZO \
  "$output"
hdiutil verify "$output"

mkdir -p "$mount_root"
hdiutil attach -nobrowse -readonly -mountpoint "$mount_root" "$output" >/dev/null
mounted=true
"$project_root/scripts/verify-macos-bundle.sh" "$mount_root/Meeting Capture.app"
hdiutil detach "$mount_root" >/dev/null
mounted=false

printf 'Created signed macOS installer: %s\n' "$output"

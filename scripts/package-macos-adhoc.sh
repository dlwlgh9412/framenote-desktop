#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -p "require('$project_root/package.json').version")"
app_id="$(node -p "require('$project_root/package.json').build.appId")"
product_name="$(node -p "require('$project_root/package.json').build.productName")"
permission_identity="D69F06BB-91BE-4A87-9B3A-88156B85CA54"
helper_id="$app_id.audio-capture"
staging_root="$(mktemp -d "${TMPDIR:-/tmp}/minuteframe-package.XXXXXX")"
unsigned_app="$project_root/release/mac-universal/$product_name.app"
signed_app="$staging_root/$product_name.app"
dmg_root="$staging_root/dmg"
pkg_name="$product_name Installer.pkg"
pkg_path="$dmg_root/$pkg_name"
output="$project_root/release/${product_name}-${version}-mac-universal.dmg"
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
npm run build:mac-native
npm run build
npx electron-builder --mac --universal --dir --config.mac.identity=null

ditto --norsrc "$unsigned_app" "$signed_app"
codesign --force --deep --sign - "$signed_app"
helper_path="$signed_app/Contents/Resources/bin/minuteframe-audio-capture"
cursor_policy_path="$signed_app/Contents/Resources/bin/minuteframe-cursor-policy.node"
codesign \
  --force \
  --sign - \
  "$cursor_policy_path"
codesign \
  --force \
  --sign - \
  --identifier "$helper_id" \
  --requirements "=designated => identifier \"$helper_id\"" \
  "$helper_path"
codesign \
  --force \
  --sign - \
  --identifier "$app_id" \
  --requirements "=designated => identifier \"$app_id\" and info[MinuteFramePermissionIdentity] = \"$permission_identity\"" \
  "$signed_app"
"$project_root/scripts/verify-macos-bundle.sh" "$signed_app"
codesign -d -r- "$signed_app" 2>&1 | grep -F "$permission_identity" >/dev/null
codesign -d -r- "$helper_path" 2>&1 | grep -F "identifier \"$helper_id\"" >/dev/null

mkdir -p "$dmg_root"
productbuild --component "$signed_app" /Applications "$pkg_path"
pkgutil --payload-files "$pkg_path" | grep -F "$product_name.app/Contents/MacOS/$product_name" >/dev/null

hdiutil create \
  -volname "$product_name ${version}" \
  -srcfolder "$dmg_root" \
  -ov \
  -format UDZO \
  "$output"
hdiutil verify "$output"

mkdir -p "$mount_root"
hdiutil attach -nobrowse -readonly -mountpoint "$mount_root" "$output" >/dev/null
mounted=true
pkgutil --payload-files "$mount_root/$pkg_name" | grep -F "$product_name.app/Contents/MacOS/$product_name" >/dev/null
hdiutil detach "$mount_root" >/dev/null
mounted=false

printf 'Created signed macOS installer: %s\n' "$output"

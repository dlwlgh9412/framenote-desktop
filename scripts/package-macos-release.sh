#!/usr/bin/env bash
set -euo pipefail

: "${CSC_LINK:?CSC_LINK must contain the Developer ID Application certificate.}"
: "${CSC_KEY_PASSWORD:?CSC_KEY_PASSWORD is required.}"
: "${MAC_INSTALLER_IDENTITY:?MAC_INSTALLER_IDENTITY must name a Developer ID Installer identity in the keychain.}"
: "${APPLE_ID:?APPLE_ID is required for notarization.}"
: "${APPLE_APP_SPECIFIC_PASSWORD:?APPLE_APP_SPECIFIC_PASSWORD is required for notarization.}"
: "${APPLE_TEAM_ID:?APPLE_TEAM_ID is required for notarization.}"

project_root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -p "require('$project_root/package.json').version")"
product_name="$(node -p "require('$project_root/package.json').build.productName")"
staging_root="$(mktemp -d "${TMPDIR:-/tmp}/minuteframe-release.XXXXXX")"
packaged_app="$project_root/release/mac-universal/$product_name.app"
dmg_root="$staging_root/dmg"
pkg_name="$product_name Installer.pkg"
pkg_path="$dmg_root/$pkg_name"
output="$project_root/release/${product_name}-${version}-mac-universal.dmg"

cleanup() {
  rm -rf "$staging_root"
}
trap cleanup EXIT

cd "$project_root"
npm run build:mac-native
npm run build
npx electron-builder --mac --universal --dir

codesign --verify --deep --strict --verbose=2 "$packaged_app"
codesign -d --verbose=4 "$packaged_app" 2>&1 | grep -F "Authority=Developer ID Application:" >/dev/null

mkdir -p "$dmg_root"
productbuild --sign "$MAC_INSTALLER_IDENTITY" --component "$packaged_app" /Applications "$pkg_path"
pkgutil --check-signature "$pkg_path" | grep -F "Developer ID Installer:" >/dev/null
pkgutil --payload-files "$pkg_path" | grep -F "$product_name.app/Contents/MacOS/$product_name" >/dev/null

hdiutil create \
  -volname "$product_name $version" \
  -srcfolder "$dmg_root" \
  -ov \
  -format UDZO \
  "$output"
hdiutil verify "$output"

xcrun notarytool submit "$output" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait
xcrun stapler staple "$output"
xcrun stapler validate "$output"

printf 'Created notarized macOS installer: %s\n' "$output"

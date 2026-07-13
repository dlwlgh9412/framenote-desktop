#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
bash "$project_root/scripts/build-macos-audio-helper.sh"
bash "$project_root/scripts/build-macos-cursor-policy.sh"

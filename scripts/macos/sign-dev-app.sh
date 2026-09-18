#!/usr/bin/env bash
# Sign a local srelens.app with the stable self-signed identity from
# ensure-dev-codesign.sh. Replaces ad-hoc / linker-signed hashes so Keychain
# ACLs ("Always Allow") survive rebuilds.
#
# Usage:
#   scripts/macos/sign-dev-app.sh
#   scripts/macos/sign-dev-app.sh path/to/srelens.app
#   CERT_NAME="…" scripts/macos/sign-dev-app.sh
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "macOS only." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CERT_NAME="${CERT_NAME:-srelens Dev Codesign}"
APP="${1:-$ROOT/target/debug/bundle/macos/srelens.app}"

if [ ! -d "$APP" ]; then
  echo "App bundle not found: $APP" >&2
  echo "Build first (cargo tauri build --debug) or pass the .app path." >&2
  exit 1
fi

"$ROOT/scripts/macos/ensure-dev-codesign.sh"

# Build-tree .app shares CFBundleIdentifier with /Applications — Spotlight
# would list two "srelens". Marker stops indexing under target/.
mkdir -p "$ROOT/target"
touch "$ROOT/target/.metadata_never_index"

# Deep sign: helpers first would be ideal; --deep covers nested Mach-O for
# a Tauri bundle without listing every framework by hand.
codesign --force --deep --options runtime --sign "$CERT_NAME" "$APP"
codesign --verify --verbose=2 "$APP"
echo "Signed: $APP"
codesign -dv --verbose=2 "$APP" 2>&1 | grep -E '^(Authority|Identifier|Signature|TeamIdentifier)=' || true
echo
echo "First launch after switching identity may still ask Keychain once — choose Always Allow."

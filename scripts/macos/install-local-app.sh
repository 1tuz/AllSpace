#!/usr/bin/env bash
# Install a local Tauri .app into /Applications and keep Spotlight from
# indexing the build-tree copy (same CFBundleIdentifier → duplicate "srelens"
# in Launchpad / Spotlight).
#
# Usage:
#   scripts/macos/install-local-app.sh
#   scripts/macos/install-local-app.sh path/to/srelens.app
#   KEEP_BUNDLE=1 scripts/macos/install-local-app.sh   # leave target/*.app
#
# Default source: target/release/bundle/macos/srelens.app, else debug.
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "macOS only." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="${DEST:-/Applications/srelens.app}"
KEEP_BUNDLE="${KEEP_BUNDLE:-0}"

pick_default_src() {
  local release="$ROOT/target/release/bundle/macos/srelens.app"
  local debug="$ROOT/target/debug/bundle/macos/srelens.app"
  if [ -d "$release" ]; then
    printf '%s\n' "$release"
  elif [ -d "$debug" ]; then
    printf '%s\n' "$debug"
  else
    return 1
  fi
}

SRC="${1:-}"
if [ -z "$SRC" ]; then
  SRC="$(pick_default_src)" || {
    echo "No srelens.app under target/{release,debug}/bundle/macos/." >&2
    echo "Build first: pnpm tauri build   (or  pnpm tauri build --debug)" >&2
    exit 1
  }
fi

if [ ! -d "$SRC" ]; then
  echo "App bundle not found: $SRC" >&2
  exit 1
fi

# Cargo/Tauri drop a full .app under target/; Spotlight indexes it and
# Launchpad shows a second identical "srelens". Empty marker = never index.
mkdir -p "$ROOT/target"
touch "$ROOT/target/.metadata_never_index"

echo "Installing: $SRC → $DEST"
# ditto preserves resource forks / codesign better than cp -R on macOS.
if [ -e "$DEST" ]; then
  rm -rf "$DEST"
fi
ditto "$SRC" "$DEST"

"$ROOT/scripts/macos/sign-dev-app.sh" "$DEST"

# Gatekeeper quarantine on copies from build dirs / DMGs.
xattr -cr "$DEST" 2>/dev/null || true

# Drop the build-tree bundle so mdfind / Spotlight cannot resurface it.
# KEEP_BUNDLE=1 when you still need to open target/.../srelens.app (perf).
case "$SRC" in
  "$ROOT/target/"*)
    if [ "$KEEP_BUNDLE" != "1" ]; then
      echo "Removing build-tree copy (Spotlight duplicate): $SRC"
      rm -rf "$SRC"
    else
      echo "KEEP_BUNDLE=1 — left $SRC (rely on target/.metadata_never_index)."
    fi
    ;;
esac

# Nudge Spotlight off any stale path under the repo target/.
if command -v mdutil >/dev/null 2>&1; then
  mdutil -E "$ROOT/target" >/dev/null 2>&1 || true
fi

echo
echo "Installed: $DEST"
echo "Only this copy should appear in Spotlight as \"srelens\"."
echo "Open: open -a srelens"
echo
echo "If a duplicate still shows for a minute: killall Dock; or wait for reindex."

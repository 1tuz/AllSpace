#!/usr/bin/env bash
# Install the latest AllSpace desktop release on this machine.
#
#   curl -fsSL https://raw.githubusercontent.com/1tuz/AllSpace/main/scripts/install.sh | bash
#
# Supported: Apple Silicon macOS (installs ~/Applications/srelens.app) and
# Linux x86_64 (installs the .deb). The whole script lives in main(), invoked
# on the last line, so a truncated download is a syntax error rather than a
# half-finished install.
set -euo pipefail

REPO="1tuz/AllSpace"
APP_DIR="$HOME/Applications"
APP_PATH="$APP_DIR/srelens.app"

# The EXIT trap runs after main() has returned, so everything it touches lives
# at file scope: a `local` would already be unset by then.
work_dir=""
mount_dir=""
mounted=false
cleanup() {
  if [[ "$mounted" == true && -n "$mount_dir" ]]; then
    hdiutil detach "$mount_dir" -quiet || true
  fi
  if [[ -n "$work_dir" && -d "$work_dir" ]]; then
    rm -rf "$work_dir"
  fi
}

main() {
  local system architecture platform platform_label asset_pattern
  local download_url asset_name tag_name source_app

  system="$(uname -s)"
  architecture="$(uname -m)"
  case "$system:$architecture" in
    Darwin:arm64) platform="macos"; platform_label="macOS Apple Silicon" ;;
    Linux:x86_64) platform="linux"; platform_label="Linux x86_64" ;;
    *)
      printf 'AllSpace installer supports Apple Silicon macOS and Linux x86_64 only.\n' >&2
      printf 'This machine reports %s %s.\n' "$system" "$architecture" >&2
      exit 1
      ;;
  esac

  work_dir="$(mktemp -d)"
  mount_dir="$work_dir/mount"
  mkdir "$mount_dir"
  trap cleanup EXIT

  if ! curl -fsSL --proto '=https' --tlsv1.2 --show-error \
    "https://api.github.com/repos/$REPO/releases/latest" -o "$work_dir/release.json"; then
    printf 'Could not read the latest AllSpace release from GitHub.\n' >&2
    printf 'Publish a v<version> tag first, or download an asset by hand from https://github.com/%s/releases\n' "$REPO" >&2
    exit 1
  fi

  tag_name="$(sed -nE 's/.*"tag_name":[[:space:]]*"([^"]*)".*/\1/p' "$work_dir/release.json" | head -n 1 || true)"

  if [[ "$platform" == macos ]]; then
    asset_pattern='_aarch64\.dmg$'
  else
    asset_pattern='_amd64\.deb$'
  fi
  download_url="$(sed -nE 's/.*"browser_download_url":[[:space:]]*"(https[^"]*)".*/\1/p' "$work_dir/release.json" |
    grep -E "$asset_pattern" | head -n 1 || true)"
  if [[ -z "$download_url" ]]; then
    printf 'The latest AllSpace release%s has no installer for %s.\n' \
      "${tag_name:+ ($tag_name)}" "$platform_label" >&2
    printf 'Available downloads: https://github.com/%s/releases/latest\n' "$REPO" >&2
    exit 1
  fi
  asset_name="$(basename "$download_url")"

  if [[ "$platform" == linux ]]; then
    curl -fL --proto '=https' --tlsv1.2 --progress-bar --show-error \
      "$download_url" -o "$work_dir/$asset_name"
    if ! sudo dpkg -i "$work_dir/$asset_name"; then
      printf '\nAllSpace %s could not be installed: the .deb dependencies are missing.\n' "${tag_name:-release}" >&2
      printf 'Fix the dependencies, then reinstall with:\n' >&2
      printf '  sudo apt-get install -f\n' >&2
      exit 1
    fi
    printf 'Installed AllSpace%s from %s. Start it from your application menu or run: srelens\n' \
      "${tag_name:+ $tag_name}" "$asset_name"
    printf 'Cluster configuration, kubeconfig, and application data were left untouched.\n'
    exit 0
  fi

  curl -fL --proto '=https' --tlsv1.2 --progress-bar --show-error \
    "$download_url" -o "$work_dir/$asset_name"
  hdiutil attach -nobrowse -readonly -mountpoint "$mount_dir" "$work_dir/$asset_name" >/dev/null
  mounted=true

  source_app="$(find "$mount_dir" -maxdepth 3 -type d -name 'srelens.app' -print -quit)"
  if [[ -z "$source_app" ]]; then
    printf 'The downloaded DMG (%s) contains no srelens.app bundle.\n' "$asset_name" >&2
    exit 1
  fi

  mkdir -p "$APP_DIR"
  rm -rf "$APP_PATH"
  ditto "$source_app" "$APP_PATH"
  # The CI build is unsigned and not notarized. Strip the quarantine flag the
  # download added and ad-hoc sign the copy so Gatekeeper lets it launch on
  # Apple Silicon.
  xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true
  codesign --force --deep --sign - "$APP_PATH"

  printf 'Installed AllSpace%s to %s\n' "${tag_name:+ $tag_name}" "$APP_PATH"
  printf 'Open it with:\n  open %s\n' "$APP_PATH"
  printf 'Cluster configuration, kubeconfig, and application data were left untouched.\n'
}

main "$@"

#!/usr/bin/env bash
# Remove the AllSpace desktop application installed by scripts/install.sh.
#
#   curl -fsSL https://raw.githubusercontent.com/1tuz/AllSpace/main/scripts/uninstall.sh | bash
#
# Supported: Apple Silicon macOS and Linux x86_64. Cluster configuration,
# kubeconfig, and application data are deliberately left in place.
set -euo pipefail

APP_DIR="$HOME/Applications"
APP_PATH="$APP_DIR/srelens.app"
DEB_PACKAGE="srelens"

main() {
  local system architecture removed

  system="$(uname -s)"
  architecture="$(uname -m)"
  removed=false
  case "$system:$architecture" in
    Darwin:arm64)
      if [[ -d "$APP_PATH" ]]; then
        rm -rf "$APP_PATH"
        printf 'Removed %s\n' "$APP_PATH"
        removed=true
      else
        printf 'AllSpace is not installed in %s\n' "$APP_PATH"
      fi
      ;;
    Linux:x86_64)
      if dpkg-query -W -f='${Status}' "$DEB_PACKAGE" 2>/dev/null | grep -q 'install ok installed'; then
        sudo dpkg --remove "$DEB_PACKAGE"
        printf 'Removed the %s package.\n' "$DEB_PACKAGE"
        removed=true
      else
        printf 'AllSpace is not installed (no dpkg package named %s).\n' "$DEB_PACKAGE"
      fi
      ;;
    *)
      printf 'AllSpace uninstaller supports Apple Silicon macOS and Linux x86_64 only.\n' >&2
      printf 'This machine reports %s %s.\n' "$system" "$architecture" >&2
      exit 1
      ;;
  esac

  if [[ "$removed" == false ]]; then
    printf 'Nothing was removed.\n'
  fi
  printf 'Cluster configuration, kubeconfig, and application data were left untouched.\n'
}

main "$@"

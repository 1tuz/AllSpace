#!/usr/bin/env bash
# Create a STABLE self-signed codesign identity in the login keychain.
#
# Why: ad-hoc / linker-signed debug .app binaries get a new CDHash every
# rebuild. macOS Keychain ACLs key off that identity, so "Always Allow" for
# srelens's vault master-key entry dies on the next build and the login-password
# prompt returns. A fixed CN identity keeps the designated requirement stable.
#
# Idempotent. No Apple Developer account. Not notarized — Gatekeeper still
# blocks first open of a downloaded copy; this is for local Keychain ACL only.
#
# Usage:
#   scripts/macos/ensure-dev-codesign.sh
#   CERT_NAME="…" KEYCHAIN_PASSWORD="…" scripts/macos/ensure-dev-codesign.sh
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "macOS only." >&2
  exit 1
fi

CERT_NAME="${CERT_NAME:-srelens Dev Codesign}"
KEYCHAIN="${KEYCHAIN:-$HOME/Library/Keychains/login.keychain-db}"

if security find-identity -v -p codesigning "$KEYCHAIN" 2>/dev/null | grep -qF "$CERT_NAME"; then
  echo "Codesign identity already present: $CERT_NAME"
  security find-identity -v -p codesigning "$KEYCHAIN" | grep -F "$CERT_NAME" || true
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$TMP/key.pem" \
  -out "$TMP/cert.pem" \
  -days 3650 \
  -subj "/CN=$CERT_NAME" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" \
  >/dev/null 2>&1

# OpenSSL 3 defaults (PBES2/AES) fail macOS SecPKCS12Import — force legacy.
P12_PW="$(openssl rand -hex 16)"
P12_ARGS=(-export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$CERT_NAME" -out "$TMP/cert.p12" -passout "pass:$P12_PW")
if openssl pkcs12 -help 2>&1 | grep -q -- '-legacy'; then
  openssl pkcs12 -legacy -macalg sha1 -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES "${P12_ARGS[@]}" >/dev/null
else
  openssl pkcs12 "${P12_ARGS[@]}" >/dev/null
fi

security import "$TMP/cert.p12" -k "$KEYCHAIN" -P "$P12_PW" -A -T /usr/bin/codesign -T /usr/bin/security >/dev/null

# User-domain trust for codesign so find-identity -v lists it. May need an
# interactive admin prompt once; failure leaves the identity usable for
# codesign -s anyway on many macOS versions.
if ! security add-trusted-cert -p codeSign -k "$KEYCHAIN" "$TMP/cert.pem" >/dev/null 2>&1; then
  echo "Note: could not write codeSign trust (often needs UI). Try Keychain Access → trust for Code Signing." >&2
fi

if [ -n "${KEYCHAIN_PASSWORD:-}" ]; then
  security set-key-partition-list -S apple-tool:,apple:,codesign: \
    -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null 2>&1 || true
fi

if ! security find-identity -v -p codesigning "$KEYCHAIN" 2>/dev/null | grep -qF "$CERT_NAME"; then
  echo "Import finished but identity not yet valid for codesign:" >&2
  security find-identity -p codesigning "$KEYCHAIN" 2>/dev/null | grep -F "$CERT_NAME" || true
  echo "Open Keychain Access → Certificates → \"$CERT_NAME\" → Trust → Code Signing: Always Trust, then re-run." >&2
  exit 1
fi

echo "Created self-signed codesign identity: $CERT_NAME"
security find-identity -v -p codesigning "$KEYCHAIN" | grep -F "$CERT_NAME" || true
echo
echo "Next: scripts/macos/sign-dev-app.sh [path/to/srelens.app]"
echo "Or:   APPLE_SIGNING_IDENTITY=\"$CERT_NAME\" cargo tauri build --debug"

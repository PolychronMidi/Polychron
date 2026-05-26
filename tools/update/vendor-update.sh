#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: tools/update/vendor-update.sh <name> <git-url> [ref]

Refresh an ignored vendored source tree under tools/<name>, then apply tracked
patches from config/<name>-patches/*.patch.

Environment:
  VENDOR_UPDATE_DRY_RUN=1  clone and check patches without replacing tools/<name>

Example:
  tools/update/vendor-update.sh opencode https://github.com/anomalyco/opencode.git dev
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ] || [ "$#" -lt 2 ]; then
  usage
  exit 2
fi

NAME="$1"
URL="$2"
REF="${3:-HEAD}"
ROOT="$(git rev-parse --show-toplevel)"
DEST="$ROOT/tools/$NAME"
PATCH_DIR="$ROOT/config/${NAME}-patches"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP_PARENT="${TMPDIR:-/tmp}/polychron-vendor-update"
CLONE="$TMP_PARENT/${NAME}-${STAMP}"
BACKUP="$TMP_PARENT/${NAME}-backup-${STAMP}"

mkdir -p "$TMP_PARENT"

if [ ! -d "$DEST" ]; then
  echo "vendor-update: missing destination: $DEST" >&2
  exit 1
fi

echo "vendor-update: cloning $URL ($REF)" >&2
if [ "$REF" = "HEAD" ]; then
  git clone --depth 1 "$URL" "$CLONE"
else
  git clone --depth 1 --branch "$REF" "$URL" "$CLONE"
fi

COMMIT="$(git -C "$CLONE" rev-parse HEAD)"
echo "vendor-update: upstream commit $COMMIT" >&2

rm -rf "$CLONE/.git"

if [ -d "$PATCH_DIR" ]; then
  shopt -s nullglob
  for patch in "$PATCH_DIR"/*.patch; do
    echo "vendor-update: applying $(basename "$patch")" >&2
    git -C "$CLONE" apply "$patch"
  done
  for patch in "$PATCH_DIR"/*.patch; do
    git -C "$CLONE" apply --check "$patch" --reverse
  done
  shopt -u nullglob
fi

if [ "${VENDOR_UPDATE_DRY_RUN:-0}" = "1" ]; then
  echo "vendor-update: dry run complete at $CLONE" >&2
  exit 0
fi

rm -rf "$BACKUP"
cp -a "$DEST" "$BACKUP"
rm -rf "$DEST"
cp -a "$CLONE" "$DEST"
rm -rf "$DEST/.git"

echo "vendor-update: replaced $DEST" >&2
echo "vendor-update: backup at $BACKUP" >&2
echo "$COMMIT"

#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: tools/update/vendor-update.sh <name> <git-url> [ref]
       tools/update/vendor-update.sh --all

Refresh an ignored vendored source tree under tools/<name>, then apply tracked
patches from config/<name>-patches/*.patch.

With --all, refresh the known local tool integrations:
  - opencode: git vendor + config/opencode-patches/*.patch
  - smolagents: git vendor + config/smolagents-patches/*.patch
  - oh-my-openagent: git vendor, no local patch unless configured later
  - omniroute: tracked npm wrapper, update npm dependency/lockfile only

Environment:
  VENDOR_UPDATE_DRY_RUN=1  clone and check patches without replacing tools/<name>

Example:
  tools/update/vendor-update.sh opencode https://github.com/anomalyco/opencode.git dev
  tools/update/vendor-update.sh --all
USAGE
}

ROOT="$(git rev-parse --show-toplevel)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP_PARENT="${TMPDIR:-/tmp}/polychron-vendor-update"

mkdir -p "$TMP_PARENT"

update_git_vendor() {
  local name="$1"
  local url="$2"
  local ref="${3:-HEAD}"
  local dest="$ROOT/tools/$name"
  local patch_dir="$ROOT/config/${name}-patches"
  local clone="$TMP_PARENT/${name}-${STAMP}"
  local backup="$TMP_PARENT/${name}-backup-${STAMP}"

  if [ ! -d "$dest" ]; then
    echo "vendor-update: missing destination: $dest" >&2
    exit 1
  fi

  echo "vendor-update: cloning $url ($ref)" >&2
  if [ "$ref" = "HEAD" ]; then
    git clone --depth 1 "$url" "$clone"
  else
    git clone --depth 1 --branch "$ref" "$url" "$clone"
  fi

  local commit
  commit="$(git -C "$clone" rev-parse HEAD)"
  echo "vendor-update: $name upstream commit $commit" >&2

  rm -rf "$clone/.git"

  if [ -d "$patch_dir" ]; then
    shopt -s nullglob
    for patch in "$patch_dir"/*.patch; do
      echo "vendor-update: applying $name/$(basename "$patch")" >&2
      git -C "$clone" apply "$patch"
    done
    for patch in "$patch_dir"/*.patch; do
      git -C "$clone" apply --check "$patch" --reverse
    done
    shopt -u nullglob
  fi

  if [ "${VENDOR_UPDATE_DRY_RUN:-0}" = "1" ]; then
    echo "vendor-update: $name dry run complete at $clone" >&2
    echo "$name $commit"
    return 0
  fi

  rm -rf "$backup"
  cp -a "$dest" "$backup"
  rm -rf "$dest"
  cp -a "$clone" "$dest"
  rm -rf "$dest/.git"

  echo "vendor-update: replaced $dest" >&2
  echo "vendor-update: backup at $backup" >&2
  echo "$name $commit"
}

update_omniroute() {
  local dest="$ROOT/tools/omniroute"

  if [ ! -d "$dest" ]; then
    echo "vendor-update: missing destination: $dest" >&2
    exit 1
  fi

  if [ "${VENDOR_UPDATE_DRY_RUN:-0}" = "1" ]; then
    local latest
    latest="$(npm view omniroute version)"
    echo "vendor-update: omniroute latest npm version $latest" >&2
    echo "omniroute npm:$latest"
    return 0
  fi

  echo "vendor-update: updating omniroute npm wrapper" >&2
  npm --prefix "$dest" install omniroute@latest --package-lock-only --ignore-scripts --legacy-peer-deps

  local version
  version="$(npm --prefix "$dest" pkg get dependencies.omniroute | tr -d '\"')"
  echo "omniroute npm:$version"
}

update_all() {
  update_git_vendor opencode https://github.com/anomalyco/opencode.git dev
  update_git_vendor smolagents https://github.com/huggingface/smolagents.git main
  update_git_vendor oh-my-openagent https://github.com/code-yeongyu/oh-my-openagent.git dev
  update_omniroute
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ] || [ "$#" -lt 1 ]; then
  usage
  exit 2
fi

case "$1" in
  --all)
    if [ "$#" -ne 1 ]; then
      usage
      exit 2
    fi
    update_all
    ;;
  *)
    if [ "$#" -lt 2 ]; then
      usage
      exit 2
    fi
    update_git_vendor "$1" "$2" "${3:-HEAD}"
    ;;
esac

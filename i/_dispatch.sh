#!/usr/bin/env bash
# Shared trivial-dispatch for i/* wrappers. Usage: exec _dispatch.sh <name> <script-rel-path> "$@"
set -e
_IH_NAME="$1"
_IH_SCRIPT="$2"
shift 2
_IH_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 "${_IH_REPO_ROOT}/scripts/hme/tool-usage-log.py" "${_IH_NAME}" "$@" &
exec python3 "${_IH_REPO_ROOT}/${_IH_SCRIPT}" "$@"

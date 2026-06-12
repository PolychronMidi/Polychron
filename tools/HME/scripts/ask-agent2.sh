#!/usr/bin/env bash
set -euo pipefail
exec "$(dirname "$0")/ask-peer.sh" blue_lead "$@"

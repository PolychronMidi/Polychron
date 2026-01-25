#!/usr/bin/env bash
# Usage: scripts/repro-target.sh '<parent>' [play_limit]
parent="$1"
PLAY_LIMIT=${2:-1}
export TARGET_PARENT="$parent"
export PLAY_LIMIT
export INDEX_TRACES=1
echo "Running repro: TARGET_PARENT=${TARGET_PARENT}, PLAY_LIMIT=${PLAY_LIMIT}, INDEX_TRACES=${INDEX_TRACES}"
npm run play:raw

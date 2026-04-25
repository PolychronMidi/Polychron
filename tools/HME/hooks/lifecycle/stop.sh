#!/usr/bin/env bash
# DEPRECATED — superseded by the JS policy evaluator at
# tools/HME/proxy/stop_chain/. This file is no longer invoked at runtime;
# the proxy's hook_bridge.js dispatches Stop events directly to the JS
# chain (which spawns the bash sub-stages in stop/ as child processes via
# shell_policy.js, providing the same env vars this dispatcher used to set).
#
# Kept on disk because:
#   1. scripts/audit-shell-undefined-vars.py reads it as the "dispatcher" of
#      the bash sub-files in stop/, learning which vars they inherit. The
#      `export` lines below mirror what shell_policy.js's wrapper sets
#      before sourcing each stage script — keeps the audit accurate.
#   2. Future contributors searching for "where does the stop chain live"
#      land here and follow the pointer to the JS evaluator.
#
# To restore the legacy bash chain (e.g. for debugging without the proxy),
# revert to a previous git revision of this file.

# Env declarations — match shell_policy.js's spawnStage() wrapper exactly.
# These are read by sub-file source scripts that the JS chain delegates to.
PROJECT_ROOT="${PROJECT_ROOT:-/home/jah/Polychron}"
PROJECT="${PROJECT_ROOT}"
_HME_HELPERS_DIR="${PROJECT_ROOT}/tools/HME/hooks/helpers"
_STOP_DIR="${PROJECT_ROOT}/tools/HME/hooks/lifecycle"
_DETECTORS_DIR="${PROJECT_ROOT}/tools/HME/scripts/detectors"
INPUT=""
export PROJECT_ROOT PROJECT _HME_HELPERS_DIR _STOP_DIR _DETECTORS_DIR INPUT

# No-op when run directly. The JS evaluator at tools/HME/proxy/stop_chain/
# is the authoritative dispatcher.
echo "[stop.sh] DEPRECATED — Stop hook chain runs via tools/HME/proxy/stop_chain/" >&2
exit 0

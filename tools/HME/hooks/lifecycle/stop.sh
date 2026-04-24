#!/usr/bin/env bash
# HME Stop: enforce implementation completeness + drive autonomous Evolver loop.
# Antipattern detection logic lives in tools/HME/scripts/detectors/*.py — each
# detector is a standalone script that reads a transcript path from argv and
# prints a status token. This dispatcher sources sub-scripts in order; each
# may `exit 0` after emitting a block decision.
_STOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_HME_HELPERS_DIR="${_STOP_DIR}/../helpers"
source "${_HME_HELPERS_DIR}/_safety.sh"
INPUT=$(cat)

for _part in _preamble autocommit lifesaver evolver detectors anti_patterns nexus_audit holograph post_hooks work_checks; do
  source "${_STOP_DIR}/stop/${_part}.sh"
done

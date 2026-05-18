#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_hooks_bootstrap.sh"
# Post-write side effects are owned by proxy middleware/28_post_write_side_effects.js.
exit 0

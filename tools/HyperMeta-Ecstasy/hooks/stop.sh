#!/usr/bin/env bash
# HME Stop: verify all work is implemented, not just documented
cat > /dev/null  # consume stdin
echo 'STOP. Re-read CLAUDE.md and the user prompt. Did you do ALL the work asked? Every change must be implemented in code, including errors that surface along the way in other involved tools or code (in /src, /tools, or wherever the request is scoped), not just documented. If you skipped anything, go back and do it now.' >&2
exit 0

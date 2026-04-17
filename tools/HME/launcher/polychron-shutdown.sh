#!/usr/bin/env bash
# Stop the HME proxy stack (proxy + shim + worker). Optional companion to
# polychron-launch.sh — the proxy otherwise keeps running indefinitely after
# VS Code closes (which is fine, it idles at ~30 MB RAM).
#
# Use cases:
#   - Reclaim the ~30 MB RAM when you're done for the day
#   - Kill a stuck stack before relaunching
#   - Script it on screen lock / logout if you want tight lifecycle

set -u

for pattern in "hme_proxy.js" "worker.py" "hme_http.py"; do
  pkill -TERM -f "$pattern" 2>/dev/null && echo "[polychron-shutdown] SIGTERM → $pattern" >&2
done
sleep 2
for pattern in "hme_proxy.js" "worker.py" "hme_http.py"; do
  pkill -KILL -f "$pattern" 2>/dev/null && echo "[polychron-shutdown] SIGKILL → $pattern" >&2
done
echo "[polychron-shutdown] stack stopped" >&2

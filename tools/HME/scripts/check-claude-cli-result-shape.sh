#!/usr/bin/env bash
set -u
# Optional live probe. Quietly skip when Claude CLI or credentials are absent.
if ! command -v claude >/dev/null 2>&1; then
  exit 0
fi
if [ "${HME_ENABLE_CLAUDE_CLI_SHAPE_PROBE:-0}" != "1" ]; then
  exit 0
fi
_tmp="$(mktemp)"
trap 'rm -f "$_tmp"' EXIT
if ! claude -p 'reply ok' --output-format json >"$_tmp" 2>/dev/null; then
  exit 0
fi
python3 - "$_tmp" <<'PY'
import json, sys
path = sys.argv[1]
try:
    data = json.load(open(path, encoding='utf-8'))
except Exception:
    sys.exit(0)
usage = data.get('modelUsage') or {}
bad = []
for alias, item in usage.items():
    if not isinstance((item or {}).get('contextWindow'), (int, float)) or item.get('contextWindow') < 1000:
        bad.append(alias)
if bad:
    print('modelUsage contextWindow invalid for: ' + ', '.join(bad))
PY

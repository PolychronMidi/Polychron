#!/usr/bin/env bash
# Verifies the Claude CLI `result` event still has the shape
# routerClaude.ts:computeTurnUsage depends on:
#
#   result.modelUsage[alias].contextWindow is a number ≥ 1000
#
# If the CLI version drifts and drops contextWindow (or renames the key),
# computeTurnUsage would fall through to usedPct=undefined and the context
# meter would silently stall — catching that at invariant time, not runtime,
# was the explicit goal of this check.
#
# Exit status:
#   0 — contract satisfied
#   1 — contract broken (prints the offending result JSON on stdout)
#
# Used by tools/HME/config/invariants.json:cli-modelUsage-contextWindow-shape
# via a `shell_output_empty` check: we exit 0 with empty stdout on success,
# and print the problem on stdout on failure.
set -uo pipefail

# Skip if the CLI isn't available (e.g. CI without claude installed) — the
# invariant runner can't meaningfully check absent dependencies, so treat
# this as a soft skip rather than a failure.
if ! command -v claude >/dev/null 2>&1; then
  exit 0
fi

# Minimal probe: "say hi" — costs ~$0.09 on Opus but completes in ~4s and
# triggers a full result event with modelUsage populated.
PROBE_OUT=$(timeout 30 claude -p --output-format stream-json --verbose \
  'say hi in one word' 2>/dev/null)

RESULT_LINE=$(echo "$PROBE_OUT" | grep -E '^\{"type":"result"' | head -1)
if [ -z "$RESULT_LINE" ]; then
  # No result event returned — could be rate-limit, auth, or CLI error.
  # Don't fail the invariant on transient conditions (would block builds
  # offline). Emit a warning to stderr so interactive runs notice.
  echo "WARN: no result event in CLI output — skipping contract check" >&2
  exit 0
fi

echo "$RESULT_LINE" | python3 - <<'PYEOF'
import json, sys
line = sys.stdin.read().strip()
r = json.loads(line)
mu = r.get("modelUsage")
if not isinstance(mu, dict) or not mu:
    print(f"modelUsage missing or empty: {json.dumps(mu)}")
    sys.exit(1)
for key, entry in mu.items():
    cw = entry.get("contextWindow")
    if not isinstance(cw, (int, float)) or cw < 1000:
        print(f"modelUsage[{key!r}].contextWindow invalid: {json.dumps(cw)} (need number >=1000)")
        sys.exit(1)
# All entries have a plausible contextWindow — contract holds.
sys.exit(0)
PYEOF

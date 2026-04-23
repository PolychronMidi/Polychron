#!/usr/bin/env bash
# Run every chaos injector; exit 0 only if every probe detected its
# injected fault. Intended for nightly/weekly cron.
#
# Purpose: keep self-coherence probes honest. Probes that can't detect
# the thing they claim to detect are epistemic liabilities — worse than
# no probe because they produce false confidence. Each chaos injector
# is the counterpart to exactly one probe; this script is the bridge
# that validates the probe layer as a whole.
set -u
set -o pipefail

_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Each entry: probe-name : injector-script
_injectors=(
  "daemon-thread-hygiene:inject-silent-thread-crash.sh"
  "llama-server-count:inject-duplicate-llama-server.sh"
  "adapter-deadline:inject-adapter-deadline.js"
)

_fail=0
_pass=0

echo "=== HME chaos battery ==="
for entry in "${_injectors[@]}"; do
  probe="${entry%%:*}"
  script="${entry##*:}"
  path="$_SCRIPT_DIR/$script"
  if [ ! -x "$path" ]; then
    echo "  SKIP: $probe ← $script (not executable)"
    continue
  fi
  echo "--- probe: $probe ← $script ---"
  # Dispatch by extension: .sh via bash, .js via node.
  case "$script" in
    *.js) _run_with=node ;;
    *)    _run_with=bash ;;
  esac
  if "$_run_with" "$path"; then
    _pass=$((_pass + 1))
  else
    _fail=$((_fail + 1))
  fi
  echo
done

echo "=== chaos battery: $_pass passed, $_fail failed ==="
if [ "$_fail" -gt 0 ]; then
  echo "FAIL — $_fail probe(s) failed to detect their injected fault; those probes are dead or weakened"
  exit 1
fi
echo "PASS — every probe caught its target failure class"
exit 0

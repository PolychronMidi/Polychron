# ANTI-STOP-ON-FAILURE: when lint/typecheck/pipeline fails, Claude must diagnose root cause and
# continue fixing — never pause, ask, or abandon. Stopping mid-stream is the psychopathic antipattern.
# ANTI-IGNORE-WARNINGS: review warnings are never "pre-existing" or "unrelated" — every warning
# in every review output must be fixed before proceeding. Labeling warnings as ignorable is a violation.

# FAIL FAST — the core invariant of this project: NO error, anywhere, ever, may be silently
# swallowed, suppressed, logged-and-dropped, or masked by a fallback value.
# Every error must surface immediately with full context all the way to the top of the agent's
# context stack. Treat every error as life-saving criticality.
#
# Block any command that introduces silent-failure patterns in code or scripts:
#   1. Empty catch blocks: catch {} or catch(e) {}
#   2. Empty .catch chains: .catch(() => {}) or .catch(function() {})
#   3. No-op error callbacks: onError: () => {}, reject: () => {}, onFail = () => {}
#   4. Fallback values masquerading as success (e.g. "no reason given" where "timeout" is needed)
#   5. Build/compile stderr suppressed: tsc/npm/node 2>/dev/null hides errors that must surface
# Use printf instead of echo — `echo "$CMD"` mis-parses commands starting
# with `-n`, `-e`, or `-E` as flags (classic shell footgun), which made
# this gate silently pass on benign-looking but flag-prefixed commands.
# Skip code-pattern checks when the command includes git commit — message text is not
# source code and legitimately describes patterns being removed (false-positive otherwise).
if printf '%s\n' "$CMD" | grep -q 'git commit'; then
  exit 0
fi
# Strip single-quoted, double-quoted, and backticked spans before
# pattern-matching. Without this, grep/rg/sed/awk invocations whose
# regex args contain the violation patterns (because the user is
# SEARCHING for the pattern, not writing it) false-positive. Same
# discipline stop_work.py + exhaust_check.py apply for their phrase
# matchers. The strip is conservative — multi-line single-quote spans
# crossing newlines are preserved as best-effort with `[^']*` (single-
# line); commands rarely span multiple newlines anyway.
_FF_STRIPPED=$(printf '%s\n' "$CMD" | sed "s/'[^']*'/ /g; s/\"[^\"]*\"/ /g; s/\`[^\`]*\`/ /g")
if printf '%s\n' "$_FF_STRIPPED" | grep -qE 'catch[[:space:]]*(\([^)]*\))?[[:space:]]*\{[[:space:]]*\}' \
   || printf '%s\n' "$_FF_STRIPPED" | grep -qE '\.catch\([[:space:]]*(function[[:space:]]*\(\)|(\([^)]*\))[[:space:]]*=>)[[:space:]]*\{[[:space:]]*\}\)' \
   || printf '%s\n' "$_FF_STRIPPED" | grep -qE '(onError|onFail|reject)[[:space:]]*[:(=][[:space:]]*(function\s*\(\)|\([^)]*\)[[:space:]]*=>)[[:space:]]*\{[[:space:]]*\}' \
   || printf '%s\n' "$_FF_STRIPPED" | grep -q 'parseArbiterResponse.*no reason given' \
   || printf '%s\n' "$_FF_STRIPPED" | grep -qE '(\btsc\b|\bnpm run\b|\bnode scripts/|\beslint\b[[:space:]])[^|;&]*2>/dev/null'; then
  _emit_block "FAIL FAST VIOLATION — silent error suppression detected. No empty catch blocks, no-op onError/reject handlers, fallback values masking failures, or suppressed build stderr. Every error MUST bubble immediately: throw it, call onError(), call _postError(), reject the promise. Log to hme-errors.log. Surface in UI. No silent failures. Assume life-saving criticality."
  exit 2
fi

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
# Skip code-pattern checks when the command includes git commit — message text is not
# source code and legitimately describes patterns being removed (false-positive otherwise).
if echo "$CMD" | grep -q 'git commit'; then
  exit 0
fi
if echo "$CMD" | grep -qE 'catch[[:space:]]*(\([^)]*\))?[[:space:]]*\{[[:space:]]*\}' \
   || echo "$CMD" | grep -qE '\.catch\([[:space:]]*(function[[:space:]]*\(\)|(\([^)]*\))[[:space:]]*=>)[[:space:]]*\{[[:space:]]*\}\)' \
   || echo "$CMD" | grep -qE '(onError|onFail|reject)[[:space:]]*[:(=][[:space:]]*(function\s*\(\)|\([^)]*\)[[:space:]]*=>)[[:space:]]*\{[[:space:]]*\}' \
   || echo "$CMD" | grep -q 'parseArbiterResponse.*no reason given' \
   || echo "$CMD" | grep -qE '(tsc|npm run|node scripts/|eslint)[^|;&]*2>/dev/null'; then
  _emit_block "FAIL FAST VIOLATION — silent error suppression detected. No empty catch blocks, no-op onError/reject handlers, fallback values masking failures, or suppressed build stderr. Every error MUST bubble immediately: throw it, call onError(), call _postError(), reject the promise. Log to hme-errors.log. Surface in UI. No silent failures. Assume life-saving criticality."
  exit 2
fi

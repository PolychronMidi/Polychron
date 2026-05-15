# Fail-fast pretooluse gate: blocks empty catch{}, .catch(()=>{}), no-op error
# callbacks, fallback-as-success, and stderr-suppressed builds. Skips git
# commit (message text != source). Uses printf (echo mis-parses -n/-e/-E flags).
if printf '%s\n' "$CMD" | grep -q 'git commit'; then
  exit 0
fi
# Strip single-quoted, double-quoted, and backticked spans before
_FF_STRIPPED=$(printf '%s\n' "$CMD" | sed "s/'[^']*'/ /g; s/\"[^\"]*\"/ /g; s/\`[^\`]*\`/ /g")
if printf '%s\n' "$_FF_STRIPPED" | grep -qE 'catch[[:space:]]*(\([^)]*\))?[[:space:]]*\{[[:space:]]*\}' \
   || printf '%s\n' "$_FF_STRIPPED" | grep -qE '\.catch\([[:space:]]*(function[[:space:]]*\(\)|(\([^)]*\))[[:space:]]*=>)[[:space:]]*\{[[:space:]]*\}\)' \
   || printf '%s\n' "$_FF_STRIPPED" | grep -qE '(onError|onFail|reject)[[:space:]]*[:(=][[:space:]]*(function\s*\(\)|\([^)]*\)[[:space:]]*=>)[[:space:]]*\{[[:space:]]*\}' \
   || printf '%s\n' "$_FF_STRIPPED" | grep -q 'parseArbiterResponse.*no reason given' \
   || printf '%s\n' "$_FF_STRIPPED" | grep -qE '(\btsc\b|\bnpm run\b|\bnode scripts/|\beslint\b[[:space:]])[^|;&]*2>/dev/null'; then  # silent-ok: optional fallback path.
  _emit_block "FAIL FAST VIOLATION -- silent error suppression detected. No empty catch blocks, no-op onError/reject handlers, fallback values masking failures, or suppressed build stderr. Every error MUST bubble immediately: throw it, call onError(), call _postError(), reject the promise. Log to hme-errors.log. Surface in UI. No silent failures. Assume life-saving criticality."
  exit 2
fi

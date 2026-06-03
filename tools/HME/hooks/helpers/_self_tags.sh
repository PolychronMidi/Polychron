# Shared self-origin tag classifier for Lifesaver/error-surface hooks.
# Tags here identify HME infrastructure health, not agent-caused work errors.

_hme_self_tag_re() {
  # Cache the canonical regex (derived from proxy/self_origin.js
  # SELF_SUPPRESSED_TAG_PATTERNS) so the PostToolUse/Stop hot paths read a file
  local _src="${PROJECT_ROOT}/tools/HME/proxy/self_origin.js"
  local _cache="${PROJECT_ROOT}/tools/HME/runtime/self-suppressed-tag-re.txt"
  if [ -f "$_cache" ] && [ "$_cache" -nt "$_src" ]; then
    cat "$_cache"
    return 0
  fi
  local _re
  # silent-ok: if node/self_origin is unavailable the classifier fails SAFE to
  # `a^` (matches nothing), so callers treat every line as agent-actionable
  # rather than wrongly suppressing real errors.
  _re="$(node -e 'const s=require(process.env.PROJECT_ROOT+"/tools/HME/proxy/self_origin"); console.log("^\\[("+s.SELF_SUPPRESSED_TAG_PATTERNS.join("|")+")\\]")' 2>/dev/null)" || { printf '%s\n' 'a^'; return 0; }
  mkdir -p "$(dirname "$_cache")" 2>/dev/null
  printf '%s\n' "$_re" > "$_cache" 2>/dev/null || true
  printf '%s\n' "$_re"
}

# HME HTTP helpers

_hme_enrich() {
  local module="$1" top_k="${2:-3}"
  _safe_curl "http://127.0.0.1:${_HME_HTTP_PORT}/enrich" "{\"query\":\"$module\",\"top_k\":$top_k}"
}

_hme_validate() {
  local module="$1"
  _safe_curl "http://127.0.0.1:${_HME_HTTP_PORT}/validate" "{\"query\":\"$module\"}"
}

_hme_kb_count() {
  local json="$1"
  _safe_int "$(_safe_jq "$json" '.kb | length' '0')"
}

_hme_kb_titles() {
  local json="$1" max="${2:-3}"
  _safe_jq "$json" '.kb[]?.title // empty' '' | head -"$max" | sed 's/^/    /'
}

_emit_activity() {
  local event="$1"; shift
  python3 "$PROJECT_ROOT/tools/HME/activity/emit.py" \
    --event="$event" "$@" >/dev/null 2>&1 &
}

#!/usr/bin/env bash
# Logic lives in pretooluse/bash/*.sh; this dispatcher sources them in order.
# Each sub-script may `exit 0` / `exit 2` after emitting a decision.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_HME_HELPERS_DIR="${SCRIPT_DIR}/../helpers"
source "${_HME_HELPERS_DIR}/_safety.sh"
source "${_HME_HELPERS_DIR}/_onboarding.sh"
INPUT=$(cat)
CMD=$(_safe_jq "$INPUT" '.tool_input.command' '')

_POLICY_OUT=$(printf '%s' "$INPUT" | node -e "const fs=require('fs'); const p=require(process.env.PROJECT_ROOT + '/tools/HME/proxy/bash_command_policy'); const raw=JSON.parse(fs.readFileSync(0,'utf8')||'{}'); const out=p.toHookResponse(p.evaluateBashInput(raw.tool_input||{}, {projectRoot:process.env.PROJECT_ROOT, supportsRunInBackground:(raw._hme_host==='claude'||(raw.tool_input&&raw.tool_input.run_in_background===true))})); if(out) process.stdout.write(out);" 2>/dev/null || true)
if [ -n "$_POLICY_OUT" ]; then
  case "$_POLICY_OUT" in
    *'"permissionDecision":"allow"'*)
      _POLICY_CMD=$(_safe_jq "$_POLICY_OUT" '.hookSpecificOutput.updatedInput.command // .hookSpecificOutput.updatedInput.cmd' "$CMD")
      _POLICY_HAS_UPDATE=$(_safe_jq "$_POLICY_OUT" 'has("hookSpecificOutput") and (.hookSpecificOutput | has("updatedInput"))' 'false')
      if [ "$_POLICY_HAS_UPDATE" = "true" ] && { [[ "$_POLICY_CMD" == *codex_structured_tool.js* ]] || [ "$_POLICY_CMD" = ":" ]; }; then
        printf '%s
' "$_POLICY_OUT"
        exit 0
      fi
      if [ "$_POLICY_HAS_UPDATE" = "true" ]; then printf '%s
' "$_POLICY_OUT"; exit 0; fi
      if [ -n "$(_hme_command_name "$_POLICY_CMD")" ]; then exit 0; fi
      ;;
  esac
  printf '%s
' "$_POLICY_OUT"
  exit 0
fi

# Defense-in-depth: wrap each source in `set +u +e` so a stray unbound-var
for _part in gates; do
  set +u +e
  source "${SCRIPT_DIR}/bash/${_part}.sh"
  _rc=$?
  set -u -e
  if [ "$_rc" -ne 0 ] && [ "$_rc" -ne 2 ]; then
    _ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
    _log="${PROJECT_ROOT:-/tmp}/log/hme-errors.log"
    mkdir -p "$(dirname "$_log")" 2>/dev/null
    printf '[%s] [pretooluse_bash.sh] sub-file %s exited rc=%d -- downstream gates may have been skipped; investigate\n' \
      "$_ts" "$_part" "$_rc" >> "$_log" 2>/dev/null  # silent-ok: optional fallback path.
  fi
done

if [ -n "$(_hme_command_name "$CMD")" ]; then exit 0; fi
exit 0

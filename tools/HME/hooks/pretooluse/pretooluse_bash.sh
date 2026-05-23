#!/usr/bin/env bash
# Logic lives in pretooluse/bash/*.sh; this dispatcher sources them in order.
# Each sub-script may `exit 0` / `exit 2` after emitting a decision.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_HME_HELPERS_DIR="${SCRIPT_DIR}/../helpers"
source "${_HME_HELPERS_DIR}/_hooks_bootstrap.sh"
INPUT=$(cat)
CMD=$(_safe_jq "$INPUT" '.tool_input.command' '')

# rationale: fast-path bypass eliminates cold `node -e` startup (~500-2000ms)
# for commands that cannot possibly trip any policy gate in bash_command_policy.
# Policy gates target: shell-meta pipelines, mkdir/rm/curl|sh, reader-guard cmds
# (cat/head/tail/sed/awk/grep/git diff|show|log|blame|cat-file), npm run main|
# snapshot|lint, snapshot-fingerprint, run.lock writes, polling tail/cat on
# tmp/*.output, i/<tool> short-form rewrite, lifesaver escalation.
# A CMD with NO shell metas AND a leading binary that is none of the above is
# guaranteed allow-noop. The node policy stays authoritative for everything
# else; this is a pure performance gate, not a semantic divergence.
_HME_BASH_FAST_OK=0
case "$CMD" in
  ''|':'|'true'|'false') _HME_BASH_FAST_OK=1 ;;
  *[\|\;\&\<\>\`\$\(\)\{\}\*\?\[\]]*) ;;  # shell meta -> full eval
  *'  '*) ;;                              # multi-line/odd whitespace -> full eval
  *)
    # Single leading binary, no metas. Whitelist binaries that never trip policy.
    _HME_BASH_FIRST=${CMD%% *}
    case "$_HME_BASH_FIRST" in
      ls|pwd|date|whoami|hostname|uname|id|true|false|:|echo|printf|sleep|wait|jobs|type|which|command|test|\[|basename|dirname|readlink|realpath)
        _HME_BASH_FAST_OK=1 ;;
    esac ;;
esac
if [ "${_HME_BASH_FAST_OK}" = "1" ]; then
  # rationale: post-policy gates may still need to run; honor them. Pre gates
  # (bash/pre/*.sh) are deny-first and cheap, so always run them too.
  for _pre in "${SCRIPT_DIR}/bash/pre/"*.sh; do
    [ -f "$_pre" ] || continue
    set +u +e; source "$_pre"; _pre_rc=$?; set -u -e
    [ "$_pre_rc" = "0" ] || exit "$_pre_rc"
  done
  for _post in "${SCRIPT_DIR}/bash/post/"*.sh; do
    [ -f "$_post" ] || continue
    set +u +e; source "$_post"; _rc=$?; set -u -e
    if [ "$_rc" -ne 0 ] && [ "$_rc" -ne 2 ]; then
      _ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
      _log="${PROJECT_ROOT}/log/hme-errors.log"
      mkdir -p "$(dirname "$_log")" 2>/dev/null
      printf '[%s] [pretooluse_bash.sh] sub-file %s exited rc=%d -- downstream gates may have been skipped; investigate\n' \
        "$_ts" "$(basename "$_post")" "$_rc" >> "$_log" 2>/dev/null  # silent-ok: optional fallback path.
    fi
  done
  exit 0
fi

# rationale: pre-policy gates auto-load from bash/pre/*.sh (deny-first phase).
for _pre in "${SCRIPT_DIR}/bash/pre/"*.sh; do
  [ -f "$_pre" ] || continue
  set +u +e
  source "$_pre"
  _pre_rc=$?
  set -u -e
  [ "$_pre_rc" = "0" ] || exit "$_pre_rc"
done

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

# rationale: post-policy gates auto-load from bash/post/*.sh (refinements).
for _post in "${SCRIPT_DIR}/bash/post/"*.sh; do
  [ -f "$_post" ] || continue
  set +u +e
  source "$_post"
  _rc=$?
  set -u -e
  if [ "$_rc" -ne 0 ] && [ "$_rc" -ne 2 ]; then
    _ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
    _log="${PROJECT_ROOT}/log/hme-errors.log"
    mkdir -p "$(dirname "$_log")" 2>/dev/null
    printf '[%s] [pretooluse_bash.sh] sub-file %s exited rc=%d -- downstream gates may have been skipped; investigate\n' \
      "$_ts" "$(basename "$_post")" "$_rc" >> "$_log" 2>/dev/null  # silent-ok: optional fallback path.
  fi
done

if [ -n "$(_hme_command_name "$CMD")" ]; then exit 0; fi
exit 0

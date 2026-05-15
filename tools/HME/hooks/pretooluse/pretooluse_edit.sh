#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
INPUT=$(cat)
_DECISION=$(printf '%s' "$INPUT" | node -e "const fs=require('fs'); const {preWriteCheck,toHookResponse}=require(process.env.PROJECT_ROOT + '/tools/HME/proxy/pre_write_check'); (async()=>{const d=await preWriteCheck(fs.readFileSync(0,'utf8')); const out=toHookResponse(d); if(out) process.stdout.write(out);})().catch(e=>{process.stderr.write(e.stack||String(e)); process.exit(1);});" 2>/tmp/hme-prewrite-edit.err)
_RC=$?
if [ "$_RC" -ne 0 ]; then _emit_block "BLOCKED: central pre-write check failed before editing. $(tail -c 500 /tmp/hme-prewrite-edit.err 2>/dev/null)"; exit 2; fi
if [ -n "$_DECISION" ]; then
  printf '%s\n' "$_DECISION"
  case "$_DECISION" in *'"permissionDecision":"deny"'*|*'"permissionDecision":"ask"'*) exit 0;; esac
fi
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
[ -x "${PROJECT_ROOT}/tools/HME/scripts/vow_bounded_reads.py" ] && PROJECT_ROOT="${PROJECT_ROOT}" python3 "${PROJECT_ROOT}/tools/HME/scripts/vow_bounded_reads.py" --reset 2>/dev/null || true
if [ -n "$FILE" ] && [ -n "${PROJECT_ROOT:-}" ]; then
  _BASE=$(basename "$FILE" 2>/dev/null | sed 's/\.[^.]*$//')
  if [ -n "$_BASE" ]; then mkdir -p "${PROJECT_ROOT}/tmp" 2>/dev/null; printf '%s\n' "$_BASE" >> "${PROJECT_ROOT}/tmp/hme-turn-edits.txt" 2>/dev/null; fi
fi
_STREAK_BEFORE=$(_streak_score)
_streak_reset
if [ "$_STREAK_BEFORE" -gt 0 ] 2>/dev/null; then _signal_emit raw_streak_reset pretooluse_edit session "{\"score_before\":${_STREAK_BEFORE}}"; fi
exit 0

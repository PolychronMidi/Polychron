#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
INPUT=$(cat)
_POLICY_OUT=$(printf '%s' "$INPUT" | node -e "const fs=require('fs'); const p=require(process.env.PROJECT_ROOT + '/tools/HME/proxy/read_policy'); const raw=JSON.parse(fs.readFileSync(0,'utf8')||'{}'); const out=p.toHookResponse(p.evaluateReadInput(raw.tool_input||{}, {projectRoot:process.env.PROJECT_ROOT, verifyLanded:process.env.HME_VERIFY_LANDED_OK!=='1'})); if(out) process.stdout.write(out);" 2>/dev/null || true)
if [ -n "$_POLICY_OUT" ]; then
  printf '%s\n' "$_POLICY_OUT"
  case "$_POLICY_OUT" in *'"permissionDecision":"deny"'*) exit 0;; esac
fi
_STREAK_BEFORE=$(_streak_score)
_streak_reset
if [ "$_STREAK_BEFORE" -gt 0 ] 2>/dev/null; then
  _signal_emit raw_streak_reset pretooluse_read session "{\"score_before\":${_STREAK_BEFORE}}"
fi
if [ -x "${PROJECT_ROOT}/tools/HME/tools/HME/scripts/vow_bounded_reads.py" ]; then
  PROJECT_ROOT="${PROJECT_ROOT}" python3 "${PROJECT_ROOT}/tools/HME/tools/HME/scripts/vow_bounded_reads.py" || exit 2
fi
exit 0

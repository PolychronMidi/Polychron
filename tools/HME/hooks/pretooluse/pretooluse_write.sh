#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_hooks_bootstrap.sh"
INPUT=$(cat)
: "${PROJECT_ROOT:?PROJECT_ROOT required by HME hook bootstrap}"
_TMP_SUBDIR="tmp"
_HME_TMP_DIR=$(printf '%s/%s' "$PROJECT_ROOT" "$_TMP_SUBDIR")
mkdir -p "$_HME_TMP_DIR" 2>/dev/null || true
_PREWRITE_ERR="${_HME_TMP_DIR}/hme-prewrite-write.err"
_DECISION=$(printf '%s' "$INPUT" | node -e "const fs=require('fs'); const {preWriteCheck,toHookResponse}=require(process.env.PROJECT_ROOT + '/tools/HME/proxy/pre_write_check'); (async()=>{const d=await preWriteCheck(fs.readFileSync(0,'utf8')); const out=toHookResponse(d); if(out) process.stdout.write(out);})().catch(e=>{process.stderr.write(e.stack||String(e)); process.exit(1);});" 2>"$_PREWRITE_ERR")
_RC=$?
if [ "$_RC" -ne 0 ]; then _emit_block "BLOCKED: central pre-write check failed before writing. $(tail -c 500 "$_PREWRITE_ERR" 2>/dev/null)"; exit 2; fi
if [ -n "$_DECISION" ]; then
  printf '%s\n' "$_DECISION"
  case "$_DECISION" in *'"permissionDecision":"deny"'*|*'"permissionDecision":"ask"'*) exit 0;; esac
fi
_RESET="${PROJECT_ROOT}/tools/HME/scripts/pretooluse_write_reset.py"
[ -x "$_RESET" ] && PROJECT_ROOT="${PROJECT_ROOT}" python3 "$_RESET" 2>/dev/null || true
exit 0

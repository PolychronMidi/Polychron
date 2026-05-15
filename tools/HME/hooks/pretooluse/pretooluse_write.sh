#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_policy_enabled.sh" 2>/dev/null || true
# HME PreToolUse: Write -- enforce lab rules, block memory saves, detect secrets
INPUT=$(cat)
_DECISION_ERR="${PROJECT_ROOT:+$PROJECT_ROOT/tmp/}hme-prewrite-check.$$.err"
[ -n "${PROJECT_ROOT:-}" ] || _DECISION_ERR="/tmp/hme-prewrite-check.$$.err"
mkdir -p "$(dirname "$_DECISION_ERR")" 2>/dev/null || true
_DECISION=$(printf '%s' "$INPUT" | node -e "const fs=require('fs'); const {preWriteCheck,toHookResponse}=require('${PROJECT_ROOT}/tools/HME/proxy/pre_write_check'); (async()=>{const d=await preWriteCheck(fs.readFileSync(0,'utf8')); process.stdout.write(toHookResponse(d));})().catch(e=>{process.stderr.write(e.stack||String(e)); process.exit(1);});" 2>"$_DECISION_ERR")
_DECISION_RC=$?
if [ "$_DECISION_RC" -ne 0 ]; then
  _ERR_SNIP="$(tail -c 500 "$_DECISION_ERR" 2>/dev/null)"
  rm -f "$_DECISION_ERR" 2>/dev/null || true
  _emit_block "BLOCKED: central pre-write check failed (rc=$_DECISION_RC). Fix tools/HME/proxy/pre_write_check.js before writing. ${_ERR_SNIP}"
  exit 2
fi
rm -f "$_DECISION_ERR" 2>/dev/null || true
if [ -n "$_DECISION" ]; then
  printf '%s\n' "$_DECISION"
  case "$_DECISION" in *'"permissionDecision":"deny"'*|*'"permissionDecision":"ask"'*) exit 0;; esac
fi
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
CONTENT=$(_safe_jq "$INPUT" '.tool_input.content' '')

# Bounded-reads vow: reset counter on write ATTEMPT (TDD-blocked attempts count).
[ -x "${PROJECT_ROOT}/tools/HME/scripts/vow_bounded_reads.py" ] && \
  PROJECT_ROOT="${PROJECT_ROOT}" python3 "${PROJECT_ROOT}/tools/HME/scripts/vow_bounded_reads.py" --reset 2>/dev/null || true
# TDD test-first gate: block new impl files lacking sibling test (HME_TDD_GATE=1).
if [ -n "$FILE" ] && [ -x "${PROJECT_ROOT}/tools/HME/scripts/tdd_test_first_gate.py" ]; then
  if ! PROJECT_ROOT="${PROJECT_ROOT}" python3 "${PROJECT_ROOT}/tools/HME/scripts/tdd_test_first_gate.py" --file "$FILE"; then
    exit 2
  fi
fi

if _policy_enabled block-comment-bloat; then
  _BLOAT_HIT=$(FILE="$FILE" CONTENT="$CONTENT" THRESHOLD="${COMMENT_BLOAT_WARN:-3}" _safe_py3 "
import os
fp = os.environ.get('FILE', '').lower()
content = os.environ.get('CONTENT', '')
threshold = int(os.environ.get('THRESHOLD', '3'))
prefixes = ('//',) if fp.endswith(('.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs')) else ('#',) if fp.endswith(('.py', '.sh', '.bash', '.yaml', '.yml', '.toml')) else ()
if not prefixes: raise SystemExit
ANNOTATIONS = ('# rationale:', '# silent-ok:', '# TODO:', '# FIXME:', '# noqa', '# pylint:', '# pyright:', '# type:', '// rationale:', '// silent-ok:', '// TODO:', '// FIXME:', '// eslint-', '// noqa')
run = 0
for ln in content.split('\n'):
    s = ln.lstrip()
    if any(s.startswith(p) for p in prefixes) and not s.startswith('#!') and not any(s.startswith(a) for a in ANNOTATIONS):
        run += 1
        if run >= threshold: print(run); break
    else: run = 0
" "")
  if [ -n "$_BLOAT_HIT" ]; then
    _emit_block "BLOCKED: Write content contains a $_BLOAT_HIT-line consecutive inline-comment block. CLAUDE.md: \"Inline comments single-line and terse.\" Trim to <=2 lines OR move prose into doc/."
    exit 2
  fi
fi

if echo "$FILE" | grep -q 'lab/sketches.js'; then
  echo 'LAB RULES: Every postBoot() must create AUDIBLE behavior via real monkey-patching. No empty sketches. Do not use V (validator) -- use Number.isFinite directly. Do not use crossLayerHelpers -- use inline layer logic. Do not return values from void functions (playNotesEmitPick returns void).' >&2
fi
# fix_antipattern: expected background failures must be logger.info, not logger.warning.
# Only genuine critical failures (interactive timeout, HTTP 500, connection refused) stay as warning.
# Catches: logger.warning(...background...) and logger.warning(...warm...failed/error...) in HME server code.
if echo "$FILE" | grep -q 'tools/HME/service/server'; then
  if echo "$CONTENT" | grep -qE 'logger\.warning\(.*\b(background|warm.*fail|warm.*error|onnx.*failed|VRAM TIGHT|lazy warm)\b'; then
    _emit_block "BLOCKED: Expected background failure logged as WARNING -- use logger.info. Only critical failures (interactive timeout, HTTP 500) should be WARNING in HME server. See ANTIPATTERN: stderr-to-UI popup spam."
    exit 2
  fi
fi
# Enrich: semantic-validate src/ writes via /validate. Blocks on high-confidence
# bugfix match (score >= 0.6); emits category-aware enrichment notice on warnings.
if echo "$FILE" | grep -qE '/Polychron/src/'; then
  MODULE=$(_extract_module "$FILE")
  VAL_CACHE="/tmp/hme-write-validate-$(printf '%s' "$MODULE" | sha1sum | cut -c1-16).json"
  if [ ! -f "$VAL_CACHE" ]; then
    curl -s -m 2 -X POST "http://127.0.0.1:${_HME_HTTP_PORT}/validate" \
      -H 'Content-Type: application/json' \
      -d "{\"query\":\"$MODULE\"}" > "$VAL_CACHE" 2>/dev/null || echo '{}' > "$VAL_CACHE"
  fi
  BLOCK_HIT=$(python3 -c "
import json
try:
  d = json.load(open('$VAL_CACHE'))
  for b in (d.get('blocks') if isinstance(d.get('blocks'), list) else []):
    if isinstance(b.get('score'), (int, float)) and b['score'] >= 0.6:
      print(b.get('title', '')[:120])
      break
except Exception:
  pass
" 2>/dev/null)
  if [ -n "$BLOCK_HIT" ]; then
    _emit_block "BLOCKED: KB has a bugfix entry \"$BLOCK_HIT\" strongly matching this module. Review with learn(query='$MODULE') before writing."
    exit 2
  fi
  WARN_TITLES=$(python3 -c "
import json
try:
  d = json.load(open('$VAL_CACHE'))
  ws = d.get('warnings') if isinstance(d.get('warnings'), list) else []
  bs = d.get('blocks') if isinstance(d.get('blocks'), list) else []
  titles = []
  for h in (bs + ws):
    if isinstance(h.get('score'), (int, float)) and h['score'] >= 0.45:
      t = str(h.get('title', ''))[:100]
      if t: titles.append(t)
    if len(titles) >= 3: break
  print('\n'.join(titles))
except Exception:
  pass
" 2>/dev/null)
  if [ -n "$WARN_TITLES" ]; then
    _emit_enrich_allow "Writing to $MODULE -- KB rules/antipatterns may apply:
$WARN_TITLES"
    _streak_tick 10
    exit 0
  fi
fi
# Auto-brief on Write (mirror of pretooluse_edit.sh). Doesn't mark BRIEF
# (preserves read_coverage). Disable: HME_AUTO_BRIEF_ON_EDIT=0.
_AUTO_BRIEF_JSON=""
if echo "$FILE" | grep -qE '/(src|tools/HME/(mcp|chat|activity|hooks|scripts|proxy|config))/'; then
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_nexus.sh"
  _auto_module=$(_extract_module "$FILE")
  if [ -n "$_auto_module" ] && ! _nexus_has BRIEF "$_auto_module"; then
    # Per-turn dedup (same scheme as pretooluse_edit.sh). Tracker is
    # cleared at turn start by userpromptsubmit.sh. Skip entirely when
    # PROJECT_ROOT is unset so dedup state never lands in /tmp/ outside
    # any project.
    _AUTO_BRIEF_TURN_FILE=""
    [ -n "${PROJECT_ROOT:-}" ] && _AUTO_BRIEF_TURN_FILE="${PROJECT_ROOT}/tmp/hme-turn-briefs.txt"
    if [ -n "$_AUTO_BRIEF_TURN_FILE" ] && [ -f "$_AUTO_BRIEF_TURN_FILE" ] \
        && grep -qFx "$_auto_module" "$_AUTO_BRIEF_TURN_FILE" 2>/dev/null; then
      _AUTO_BRIEF_SKIP=1
    fi
    if [ "${HME_AUTO_BRIEF_ON_EDIT:-1}" != "0" ] && [ -z "${_AUTO_BRIEF_SKIP:-}" ] \
        && [ -n "$_AUTO_BRIEF_TURN_FILE" ]; then
      # Fast path via /enrich (~70ms) + file head -- same budget as
      # pretooluse_edit.sh. Write may target a new file (head empty);
      # KB hits alone are still useful in that case.
      _kb_hits=$(curl -sf --max-time 2 -X POST -H 'Content-Type: application/json' \
        --data-binary "{\"query\":\"${_auto_module}\",\"top_k\":3}" \
        "http://127.0.0.1:${_HME_HTTP_PORT}/enrich" 2>/dev/null \
        | python3 -c "
import json, sys
try:
  d = json.load(sys.stdin)
  for e in (d.get('kb') or [])[:3]:
    cat = str(e.get('category','?'))
    title = str(e.get('title',''))[:120]
    if title: print(f'  [{cat}] {title}')
except Exception: pass
" 2>/dev/null)
      _file_head=""
      [ -f "$FILE" ] && _file_head=$(head -n 30 "$FILE" 2>/dev/null | head -c 1200)
      if [ -n "$_kb_hits" ] || [ -n "$_file_head" ]; then
        _brief="module: ${_auto_module}"
        [ -n "$_kb_hits" ] && _brief="${_brief}
KB:
${_kb_hits}"
        [ -n "$_file_head" ] && _brief="${_brief}
file head:
${_file_head}"
        _AUTO_BRIEF_JSON=$(jq -nR --arg b "$_brief" --arg m "$_auto_module" \
          '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",additionalContext:("[hme auto-brief: " + $m + "]\n" + $b + "\n[/hme auto-brief]")}}' 2>/dev/null)
        if [ -x "$PROJECT_ROOT/tools/HME/activity/emit.py" ]; then
          # Horizon VII: caused_by = the file path being written.
          python3 "$PROJECT_ROOT/tools/HME/activity/emit.py" \
            --event=auto_brief_injected \
            --file="$FILE" \
            --module="$_auto_module" \
            --caused_by="pretooluse_write:$FILE" \
            >/dev/null 2>&1 &
        fi
        mkdir -p "$(dirname "$_AUTO_BRIEF_TURN_FILE")" 2>/dev/null
        printf '%s\n' "$_auto_module" >> "$_AUTO_BRIEF_TURN_FILE" 2>/dev/null
      fi
    fi
  fi
fi

_streak_tick 10
if ! _streak_check; then exit 1; fi
[ -n "$_AUTO_BRIEF_JSON" ] && printf '%s\n' "$_AUTO_BRIEF_JSON"
exit 0

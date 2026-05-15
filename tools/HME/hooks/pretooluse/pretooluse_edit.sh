#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_onboarding.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_policy_enabled.sh" 2>/dev/null || true  # silent-ok: optional fallback path.
# PreToolUse: Edit -- canonical JS pre-write policy + local onboarding/KB side effects.
INPUT=$(cat)
_DECISION_ERR="${PROJECT_ROOT:+$PROJECT_ROOT/tmp/}hme-prewrite-check.$$.err"
[ -n "${PROJECT_ROOT:-}" ] || _DECISION_ERR="/tmp/hme-prewrite-check.$$.err"
mkdir -p "$(dirname "$_DECISION_ERR")" 2>/dev/null || true
_DECISION=$(printf '%s' "$INPUT" | node -e "const fs=require('fs'); const {preWriteCheck,toHookResponse}=require('${PROJECT_ROOT}/tools/HME/proxy/pre_write_check'); (async()=>{const d=await preWriteCheck(fs.readFileSync(0,'utf8')); process.stdout.write(toHookResponse(d));})().catch(e=>{process.stderr.write(e.stack||String(e)); process.exit(1);});" 2>"$_DECISION_ERR")
_DECISION_RC=$?
if [ "$_DECISION_RC" -ne 0 ]; then
  _ERR_SNIP="$(tail -c 500 "$_DECISION_ERR" 2>/dev/null)"  # silent-ok: optional fallback path.
  rm -f "$_DECISION_ERR" 2>/dev/null || true
  _emit_block "BLOCKED: central pre-write check failed (rc=$_DECISION_RC). Fix tools/HME/proxy/pre_write_check.js before editing. ${_ERR_SNIP}"
  exit 2
fi
rm -f "$_DECISION_ERR" 2>/dev/null || true
if [ -n "$_DECISION" ]; then
  printf '%s\n' "$_DECISION"
  case "$_DECISION" in *'"permissionDecision":"deny"'*|*'"permissionDecision":"ask"'*) exit 0;; esac
fi
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
NEW_STRING=$(_safe_jq "$INPUT" '.tool_input.new_string' '')

_TURN_EDIT_STATE="${PROJECT_ROOT:-}/tmp/hme-turn-edits.txt"
_MODULE_BASE=$(basename "$FILE" 2>/dev/null | sed 's/\.[^.]*$//')  # silent-ok: optional fallback path.
if [ -n "$_MODULE_BASE" ] && [ -n "${PROJECT_ROOT:-}" ] && [ -f "${PROJECT_ROOT}/output/metrics/hme-coupling.json" ]; then
  if [ -f "$_TURN_EDIT_STATE" ]; then
    while IFS= read -r _prior_mod; do
      [ -z "$_prior_mod" ] && continue
      [ "$_prior_mod" = "$_MODULE_BASE" ] && continue
      _AB_HIT=$(python3 - "$_MODULE_BASE" "$_prior_mod" "${PROJECT_ROOT}/output/metrics/hme-coupling.json" <<'PYEOF' 2>/dev/null  # silent-ok: optional fallback path.
import json, sys
a, b, cf = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    d = json.load(open(cf))
    for bridge in (d.get("antagonist_bridges") or []):
        ma = bridge.get("pair_a") or bridge.get("module_a") or ""
        mb = bridge.get("pair_b") or bridge.get("module_b") or ""
        if {ma, mb} == {a, b}:
            r = bridge.get("r") or bridge.get("correlation") or "?"
            print(f"{r}")
            break
except Exception:
    pass
PYEOF
)
      if [ -n "$_AB_HIT" ]; then
        echo "[hme] COUPLING WARNING: $_MODULE_BASE <-> $_prior_mod are registered antagonists (r=$_AB_HIT). Consider separate commits -- commingling antagonistic edits makes drift attribution harder." >&2
      fi
    done < "$_TURN_EDIT_STATE"
  fi
fi
# Recording deferred to AFTER blocking gates -- see end of file.

# Bounded-reads vow: reset counter on edit ATTEMPT (TDD-blocked attempts still
# break the read streak; counter should reflect "agent tried to act").
[ -x "${PROJECT_ROOT}/tools/HME/scripts/vow_bounded_reads.py" ] && \
  PROJECT_ROOT="${PROJECT_ROOT}" python3 "${PROJECT_ROOT}/tools/HME/scripts/vow_bounded_reads.py" --reset 2>/dev/null || true  # silent-ok: optional fallback path.
# TDD test-first gate: block new impl files lacking sibling test (HME_TDD_GATE=1).
if [ -n "$FILE" ] && [ -x "${PROJECT_ROOT}/tools/HME/scripts/tdd_test_first_gate.py" ]; then
  if ! PROJECT_ROOT="${PROJECT_ROOT}" python3 "${PROJECT_ROOT}/tools/HME/scripts/tdd_test_first_gate.py" --file "$FILE"; then
    exit 2
  fi
fi
# Architectural-decision audit. The retired `consulted` field is retained
# for historical readers; new rows use `reviewed`.
case "$FILE" in
  *CLAUDE.md|*doc/templates/TODO.md|*.claude/agents/*.md|*tools/HME/scripts/detectors/*.py|*tools/HME/proxy/stop_chain/policies/*.js)
    _DA_LOG="$PROJECT_ROOT/output/metrics/decision-audit.jsonl"
    mkdir -p "$(dirname "$_DA_LOG")" 2>/dev/null
    _DA_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    printf '{"ts":"%s","file":"%s","reviewed":%s,"consulted":%s,"skip_reason":"%s"}\n' \
      "$_DA_TS" "$FILE" false false "" >> "$_DA_LOG" 2>/dev/null || true  # silent-ok: optional fallback path.
    ;;
esac

if _policy_enabled block-comment-bloat; then
  _BLOAT_HIT=$(FILE="$FILE" NEW_STRING="$NEW_STRING" THRESHOLD="${COMMENT_BLOAT_WARN:-3}" LONG_LINE="${COMMENT_BLOAT_LONG_LINE:-90}" _safe_py3 "
import os
fp = os.environ.get('FILE', '').lower()
content = os.environ.get('NEW_STRING', '')
threshold = int(os.environ.get('THRESHOLD', '3'))
long_line = int(os.environ.get('LONG_LINE', '90'))
prefixes = ('//',) if fp.endswith(('.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs')) else ('#',) if fp.endswith(('.py', '.sh', '.bash', '.yaml', '.yml', '.toml')) else ()
if not prefixes: raise SystemExit
ANNOTATIONS = ('# rationale:', '# silent-ok:', '# TODO:', '# FIXME:', '# noqa', '# pylint:', '# pyright:', '# type:', '// rationale:', '// silent-ok:', '// TODO:', '// FIXME:', '// eslint-', '// noqa')
run = 0
for ln in content.split('\n'):
    s = ln.lstrip()
    if any(s.startswith(p) for p in prefixes) and not s.startswith('#!'):
        if len(ln) >= long_line:
            print(f'LONG:{len(ln)}')
            break
        if not any(s.startswith(a) for a in ANNOTATIONS):
            run += 1
            if run >= threshold:
                print(f'BLOCK:{run}')
                break
        else:
            run = 0
    else: run = 0
" "")
  if [ -n "$_BLOAT_HIT" ]; then
    case "$_BLOAT_HIT" in
      LONG:*)
        _BLOAT_LEN="${_BLOAT_HIT#LONG:}"
        _emit_block "BLOCKED: Edit new_string contains a comment line of $_BLOAT_LEN chars (>= ${COMMENT_BLOAT_LONG_LINE:-90} char limit). CLAUDE.md: \"Inline comments single-line and terse. Elaboration goes in doc/.\" Long rationale lines belong in doc/."
        ;;
      BLOCK:*)
        _BLOAT_LEN="${_BLOAT_HIT#BLOCK:}"
        _emit_block "BLOCKED: Edit new_string contains a $_BLOAT_LEN-line consecutive inline-comment block. CLAUDE.md: \"Inline comments single-line and terse. Elaboration goes in doc/.\" Trim to <=2 lines OR move the prose into doc/."
        ;;
    esac
    exit 2
  fi
fi

if echo "$FILE" | grep -qE '/Polychron/src/.*\.(js|ts|tsx|mjs|cjs)$'; then
  # Semantic bugfix lookup -- ask the worker if this module has a known bugfix
  MODULE=$(basename "$FILE" | sed 's/\.[^.]*$//')
  if [ -n "$MODULE" ] && [ ${#NEW_STRING} -gt 20 ]; then
    HASH=$(printf '%s' "$NEW_STRING" | sha1sum | cut -c1-16)
    CACHE="/tmp/hme-edit-validate-$HASH.json"
    if [ ! -f "$CACHE" ]; then
      # 500ms timeout (was 2s, blew p95). Healthy worker fits; degraded
      # worker writes {} and skips the KB check this turn.
      curl -s -m 0.5 -X POST "http://127.0.0.1:${_HME_HTTP_PORT}/validate" \
        -H 'Content-Type: application/json' \
        -d "{\"query\":\"$MODULE\"}" > "$CACHE" 2>/dev/null || echo '{}' > "$CACHE"  # silent-ok: optional fallback path.
    fi
    BLOCK_HIT=$(python3 -c "
import json, sys
try:
  d = json.load(open('$CACHE'))
  for b in (d.get('blocks') if isinstance(d.get('blocks'), list) else []):
    if isinstance(b.get('score'), (int, float)) and b['score'] >= 0.6:
      print(b.get('title', '')[:120])
      break
except Exception:
  pass
" 2>/dev/null)  # silent-ok: optional fallback path.
    if [ -n "$BLOCK_HIT" ]; then
      _emit_block "BLOCKED: KB has a bugfix entry \"$BLOCK_HIT\" that strongly matches this module. Review it via learn(query='$MODULE') before editing -- the edit may re-introduce a past bug."
      exit 2
    fi
  fi
fi

if echo "$FILE" | grep -qE '/Polychron/src/' && ! _onb_is_graduated; then
  MODULE=$(_extract_module "$FILE")
  TARGET=$(_onb_target)
  if [ -n "$TARGET" ] && [ "$MODULE" != "$TARGET" ]; then
    echo "NEXUS: Editing $MODULE but onboarding target is $TARGET. Proceeding (warning, not a block)." >&2
  fi
fi

# Unbriefed-edit auto-brief: fetch + additionalContext inject. Doesn't call
# _brief_add (preserves read_coverage). Disable: HME_AUTO_BRIEF_ON_EDIT=0.
_AUTO_BRIEF_JSON=""
if echo "$FILE" | grep -qE '/(src|tools/HME/(mcp|chat|activity|hooks|scripts|proxy|config))/'; then
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_nexus.sh"
  _auto_module=$(_extract_module "$FILE")
  if [ -n "$_auto_module" ] && ! _nexus_has BRIEF "$_auto_module"; then
    if [ -x "$PROJECT_ROOT/tools/HME/activity/emit.py" ]; then
      # Horizon VII maturity: caused_by = the file path being edited
      # without a prior brief -- the cause IS the unbriefed edit target.
# silent-ok: optional fallback path.
      python3 "$PROJECT_ROOT/tools/HME/activity/emit.py" \
        --event=edit_without_brief \
        --file="$FILE" \
        --module="$_auto_module" \
        --caused_by="unbriefed_edit:$FILE" \
        --session="${USER:-shell}" \
        >/dev/null 2>&1 &
    fi
    # Per-turn dedup tracker (cleared at turn start by userpromptsubmit.sh).
    # Skip when PROJECT_ROOT unset to avoid /tmp/ leak.
    _AUTO_BRIEF_TURN_FILE=""
    [ -n "${PROJECT_ROOT:-}" ] && _AUTO_BRIEF_TURN_FILE="${PROJECT_ROOT}/tmp/hme-turn-briefs.txt"
    if [ -n "$_AUTO_BRIEF_TURN_FILE" ] && [ -f "$_AUTO_BRIEF_TURN_FILE" ] \
        && grep -qFx "$_auto_module" "$_AUTO_BRIEF_TURN_FILE" 2>/dev/null; then  # silent-ok: optional fallback path.
      _AUTO_BRIEF_SKIP=1
    fi
    if [ "${HME_AUTO_BRIEF_ON_EDIT:-1}" != "0" ] && [ -z "${_AUTO_BRIEF_SKIP:-}" ] \
        && [ -n "$_AUTO_BRIEF_TURN_FILE" ]; then
      # /enrich KB hits (~70ms) + head of target file. 500ms timeout
# silent-ok: optional fallback path.
      _kb_hits=$(curl -sf --max-time 0.5 -X POST -H 'Content-Type: application/json' \
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
" 2>/dev/null)  # silent-ok: optional fallback path.
      _file_head=$(head -n 30 "$FILE" 2>/dev/null | head -c 1200)  # silent-ok: optional fallback path.
      if [ -n "$_kb_hits" ] || [ -n "$_file_head" ]; then
        _brief="module: ${_auto_module}"
        [ -n "$_kb_hits" ] && _brief="${_brief}
KB:
${_kb_hits}"
        [ -n "$_file_head" ] && _brief="${_brief}
file head:
${_file_head}"
        _AUTO_BRIEF_JSON=$(jq -nR --arg b "$_brief" --arg m "$_auto_module" \
          '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",additionalContext:("[hme auto-brief: " + $m + "]\n" + $b + "\n[/hme auto-brief]")}}' 2>/dev/null)  # silent-ok: optional fallback path.
        if [ -x "$PROJECT_ROOT/tools/HME/activity/emit.py" ]; then
          # Horizon VII: caused_by = the file path being edited
          # (the cause of the auto-briefing was the agent's Edit on FILE).
          python3 "$PROJECT_ROOT/tools/HME/activity/emit.py" \
            --event=auto_brief_injected \
            --file="$FILE" \
            --module="$_auto_module" \
            --caused_by="pretooluse_edit:$FILE" \
            >/dev/null 2>&1 &
        fi
        # Record this module so subsequent Edits/Writes to the same
        # module skip the brief instead of redundantly re-firing /enrich.
        mkdir -p "$(dirname "$_AUTO_BRIEF_TURN_FILE")" 2>/dev/null
        printf '%s\n' "$_auto_module" >> "$_AUTO_BRIEF_TURN_FILE" 2>/dev/null  # silent-ok: optional fallback path.
      fi
    fi
  fi
fi

if [ -n "$_MODULE_BASE" ] && [ -n "${PROJECT_ROOT:-}" ]; then
  mkdir -p "$(dirname "$_TURN_EDIT_STATE")" 2>/dev/null
  echo "$_MODULE_BASE" >> "$_TURN_EDIT_STATE"
fi

_streak_tick 10
if ! _streak_check; then exit 1; fi
[ -n "$_AUTO_BRIEF_JSON" ] && printf '%s\n' "$_AUTO_BRIEF_JSON"
exit 0

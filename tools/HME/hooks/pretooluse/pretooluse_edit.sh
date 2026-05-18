#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_hooks_bootstrap.sh"
INPUT=$(cat)
_DECISION=$(printf '%s' "$INPUT" | node -e "const fs=require('fs'); const {preWriteCheck,toHookResponse}=require(process.env.PROJECT_ROOT + '/tools/HME/proxy/pre_write_check'); (async()=>{const d=await preWriteCheck(fs.readFileSync(0,'utf8')); const out=toHookResponse(d); if(out) process.stdout.write(out);})().catch(e=>{process.stderr.write(e.stack||String(e)); process.exit(1);});" 2>/tmp/hme-prewrite-edit.err)
_RC=$?
if [ "$_RC" -ne 0 ]; then _emit_block "BLOCKED: central pre-write check failed before editing. $(tail -c 500 /tmp/hme-prewrite-edit.err 2>/dev/null)"; exit 2; fi
if [ -n "$_DECISION" ]; then
  printf '%s\n' "$_DECISION"
  case "$_DECISION" in *'"permissionDecision":"deny"'*|*'"permissionDecision":"ask"'*) exit 0;; esac
fi
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
NEW_STRING=$(_safe_jq "$INPUT" '.tool_input.new_string' '')

# Antagonism warning: fires when this edit's module + a prior same-turn edit are registered antagonists (r<=-0.3).
_TURN_EDIT_STATE="${PROJECT_ROOT:-}/tmp/hme-turn-edits.txt"
_MODULE_BASE=$(basename "$FILE" 2>/dev/null | sed 's/\.[^.]*$//')
if [ -n "$_MODULE_BASE" ] && [ -n "${PROJECT_ROOT:-}" ] && [ -f "${PROJECT_ROOT}/src/output/metrics/hme-coupling.json" ]; then
  if [ -f "$_TURN_EDIT_STATE" ]; then
    while IFS= read -r _prior_mod; do
      [ -z "$_prior_mod" ] && continue
      [ "$_prior_mod" = "$_MODULE_BASE" ] && continue
      _AB_HIT=$(python3 - "$_MODULE_BASE" "$_prior_mod" "${PROJECT_ROOT}/src/output/metrics/hme-coupling.json" <<'PYEOF' 2>/dev/null
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

# Mid-pipeline src edit block. JS counterpart: block-mid-pipeline-write.
if _policy_enabled block-mid-pipeline-write && [ -f "${PROJECT_ROOT}/tmp/run.lock" ] && echo "$FILE" | grep -qE '/Polychron/src/'; then
  _emit_block "ABANDONED PIPELINE: npm run main is running (tmp/run.lock present). Do NOT edit src/ code mid-pipeline -- the pipeline's behavior is being measured against the code state at launch. Wait for completion; use HME tools (i/learn, i/review, i/trace) or edit tooling/docs in the meantime."
  exit 2
fi

# Block edits to the auto-memory directory (parity with pretooluse_write.sh).
# Memories are deprecated; HME KB (i/learn) is canonical.
if echo "$FILE" | grep -qE '\.claude/projects/.*/(memory/|MEMORY\.md)'; then
  _emit_block "BLOCKED: The .claude/projects memory directory is deprecated. Use HME KB instead: i/learn title=\"...\" content=\"...\" category=\"feedback\". Memories that point at behavioral rules belong in CLAUDE.md, not memory/."
  exit 2
fi

# Block edits to misplaced log/, metrics/, or tmp/ directories
if echo "$FILE" | grep -qE '/(log|tmp)/'; then
  if ! echo "$FILE" | grep -qE '^'"${PROJECT_ROOT}"'/(log|tmp)/'; then
    _emit_block "BLOCKED: log/ and tmp/ only exist at project root. Do not edit files inside subdirectory variants. Route output through \$PROJECT_ROOT/{log,tmp}/."
    exit 2
  fi
fi
if echo "$FILE" | grep -qE '/metrics/'; then
  if ! echo "$FILE" | grep -qE '^'"${PROJECT_ROOT}"'/output/metrics/'; then
    _emit_block "BLOCKED: metrics/ only exists at output/metrics/. Do not edit files in any other metrics/ directory."
    exit 2
  fi
fi

if echo "$NEW_STRING" | grep -qiE '(#|//|/\*)[[:space:]]*(\.\.\.)?[[:space:]]*(existing|rest of|previous)[[:space:]]+(code|file|implementation|content|functions?)[[:space:]]*(\.\.\.)?'; then
  _emit_block "BLOCKED: Edit new_string contains comment-ellipsis stub placeholder. Use the ACTUAL replacement content -- no stubs."
  exit 2
fi

# Hardcoded-project-root guard: rejects host-specific path baked into
# source. Use $PROJECT_ROOT / $CLAUDE_PROJECT_DIR / walk-up. Matches
# against LIVE PROJECT_ROOT to avoid false-positive on other clones.
if [ -n "${PROJECT_ROOT:-}" ] \
   && echo "$NEW_STRING" | grep -qF "$PROJECT_ROOT" \
   && echo "$FILE" | grep -qE '\.(sh|py|js|ts|tsx|mjs|cjs|json|yaml|yml|md)$' \
   && ! echo "$NEW_STRING" | grep -qE '"PROJECT_ROOT":[^,}]*"'"$PROJECT_ROOT"'"' \
   && ! echo "$FILE" | grep -qE '(/\.env(\.[a-z]+)?$|/README(\.[a-z]+)?$|/CLAUDE\.md$|/tools/HME/KB/devlog/|/doc/[^/]+\.md$|/doc/archive/)'; then
  _emit_block "BLOCKED: Edit new_string contains hardcoded project root '$PROJECT_ROOT'. Use \$PROJECT_ROOT (already set by .env via _safety.sh) or \$CLAUDE_PROJECT_DIR (Claude Code env var) -- never a host-specific path. The .env file itself is the only legitimate place for the literal path; it's checked-in but each clone overrides it. Exempt files: README, CLAUDE.md, devlog snapshots."
  exit 2
fi

# Bounded-reads vow: reset counter on edit ATTEMPT (TDD-blocked attempts still
# break the read streak; counter should reflect "agent tried to act").
[ -x "${PROJECT_ROOT}/tools/HME/scripts/vow_bounded_reads.py" ] && \
  PROJECT_ROOT="${PROJECT_ROOT}" python3 "${PROJECT_ROOT}/tools/HME/scripts/vow_bounded_reads.py" --reset 2>/dev/null || true
# TDD test-first gate: block new impl files lacking sibling test (HME_TDD_GATE=1).
if [ -n "$FILE" ] && [ -x "${PROJECT_ROOT}/tools/HME/scripts/tdd_test_first_gate.py" ]; then
  if ! PROJECT_ROOT="${PROJECT_ROOT}" python3 "${PROJECT_ROOT}/tools/HME/scripts/tdd_test_first_gate.py" --file "$FILE"; then
    exit 2
  fi
fi
# Architectural-decision audit. Legacy consult fields are retained so
# existing decision-audit readers can still parse historical rows.
case "$FILE" in
  *CONSTITUTION.md|*CLAUDE.md|*doc/templates/SPEC.md|*.claude/agents/*.md|*tools/HME/scripts/detectors/*.py|*tools/HME/proxy/stop_chain/policies/*.js)
    _DA_LOG="$PROJECT_ROOT/src/output/metrics/decision-audit.jsonl"
    mkdir -p "$(dirname "$_DA_LOG")" 2>/dev/null
    _DA_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    printf '{"ts":"%s","file":"%s","consulted":%s,"skip_reason":"%s"}\n' \
      "$_DA_TS" "$FILE" false "" >> "$_DA_LOG" 2>/dev/null || true
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
ANNOTATIONS = ('# silent-ok:', '# TODO:', '# FIXME:', '# noqa', '# pylint:', '# pyright:', '# type:', '// silent-ok:', '// TODO:', '// FIXME:', '// eslint-', '// noqa')
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

# CONSTITUTION rule 3: naked except:pass without silent-ok annotation.
if echo "$FILE" | grep -qE '\.py$'; then
  _SILENT_OK_HIT=$(NEW_STRING="$NEW_STRING" _safe_py3 "
import os, re
content = os.environ.get('NEW_STRING', '')
pat = re.compile(r'except[^:\n]*:\s*\n[ \t]*pass\b', re.MULTILINE)
for m in pat.finditer(content):
    window = content[max(0, m.start()-200):m.end()+200]
    if 'silent-ok' in window:
        continue
    print('1')
    break
" "")
  if [ -n "$_SILENT_OK_HIT" ]; then
    _emit_block "BLOCKED: Edit new_string contains naked 'except: pass' without '# silent-ok: <reason>' annotation. CONSTITUTION rule 3 (Errors propagate / fail-fast): errors that are genuinely safe to discard get an inline '# silent-ok: <reason>' comment naming WHY. Either annotate or propagate."
    exit 2
  fi
fi

# Block 4+ identical non-word, non-whitespace, non-paren/bracket characters
# in a row (visual-decoration spam). JS counterpart: block-character-spam.
if _policy_enabled block-character-spam; then
  _SPAM_HIT=$(NEW_STRING="$NEW_STRING" _safe_py3 "
import os, re
content = os.environ.get('NEW_STRING', '')
PAT = re.compile(r'([^\w\s()\[\]{}])\1{3,}')
for i, line in enumerate(content.split('\n'), 1):
    if 'spam-ok' in line: continue
    m = PAT.search(line)
    if m:
        print(f'line {i}: {m.group(1)!r}x{len(m.group(0))}')
        break
" "")
  if [ -n "$_SPAM_HIT" ]; then
    _emit_block "BLOCKED: Edit new_string contains a run of 4+ identical decoration characters ($_SPAM_HIT). Visual-decoration spam (runs of dashes, equals, hashes, pipes, tildes, slashes, unicode box-drawing) is banned. Use plain text; normalize markdown table separators to 3 dashes per cell; demote headings to depth <=3. Append the literal token spam-ok on a line to opt out where genuinely required."
    exit 2
  fi
fi

# Pre-save pattern lint -- block new_string before it lands if it introduces
# forbidden patterns. Each block cites the rule + the fix, so the message
# alone is enough for the agent to correct the edit.
if echo "$FILE" | grep -qE '/Polychron/src/.*\.(js|ts|tsx|mjs|cjs)$'; then
  if echo "$NEW_STRING" | grep -qE '\bglobalThis\.|(^|[^a-zA-Z_])global\.[a-zA-Z_]'; then
    _emit_block "BLOCKED: new_string uses global. or globalThis. -- 5 Core Principles #1 forbids these. Reference the global directly (declared in globals.d.ts)."
    exit 2
  fi
  if echo "$NEW_STRING" | grep -qE '\|\|[[:space:]]*(0|\[\]|\{\})([^a-zA-Z0-9_]|$)'; then
    _emit_block "BLOCKED: new_string uses || 0 / || [] / || {} fallback -- 5 Core Principles #2 requires fail-fast. Use validator.optionalFinite(val, fallback) or validator.create('Module') + required checks."
    exit 2
  fi
  if echo "$NEW_STRING" | grep -qE '\.getSnapshot\(\)[[:space:]]*\.[[:space:]]*couplingMatrix'; then
    _emit_block "BLOCKED: new_string reads .couplingMatrix off getSnapshot() -- forbidden outside coupling engine / meta-controllers (local/no-direct-coupling-matrix-read). Register a bias via conductorIntelligence instead."
    exit 2
  fi
  if echo "$NEW_STRING" | grep -qE '\bconsole\.warn\b' && ! echo "$NEW_STRING" | grep -qE "console\.warn\([^)]*['\"]Acceptable warning:"; then
    _emit_block "BLOCKED: console.warn without 'Acceptable warning:' prefix -- CLAUDE.md Code Style rule. Format: console.warn('Acceptable warning: <message>')."
    exit 2
  fi
  if echo "$NEW_STRING" | grep -qE 'setBinaural\s*\(\s*([0-7](\.[0-9]+)?|1[3-9]|[2-9][0-9])\b'; then
    _emit_block "BLOCKED: setBinaural called outside alpha range 8-12Hz -- Hard Rule (binaural is imperceptible neurostimulation only). Clamp to [8, 12]."
    exit 2
  fi

  # Semantic bugfix lookup -- ask the worker if this module has a known bugfix
  # in KB that scores high against the current edit intent. High-confidence
  # hits (score >= 0.6) block: the edit is likely re-introducing a past bug.
  # Cache in /tmp by content hash so repeat attempts don't re-query.
  MODULE=$(basename "$FILE" | sed 's/\.[^.]*$//')
  if [ -n "$MODULE" ] && [ ${#NEW_STRING} -gt 20 ]; then
    HASH=$(printf '%s' "$NEW_STRING" | sha1sum | cut -c1-16)
    CACHE="/tmp/hme-edit-validate-$HASH.json"
    if [ ! -f "$CACHE" ]; then
      # 500ms timeout (was 2s, blew p95). Healthy worker fits; degraded
      # worker writes {} and skips the KB check this turn.
      curl -s -m 0.5 -X POST "http://127.0.0.1:${HME_MCP_PORT:-9098}/validate" \
        -H 'Content-Type: application/json' \
        -d "{\"query\":\"$MODULE\"}" > "$CACHE" 2>/dev/null || echo '{}' > "$CACHE"
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
" 2>/dev/null)
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
      python3 "$PROJECT_ROOT/tools/HME/activity/emit.py" \
        --event=edit_without_brief \
        --file="$FILE" \
        --module="$_auto_module" \
        --caused_by="unbriefed_edit:$FILE" \
        --session="$(whoami 2>/dev/null || echo shell)" \
        >/dev/null 2>&1 &
    fi
    # Per-turn dedup tracker (cleared at turn start by userpromptsubmit.sh).
    # Skip when PROJECT_ROOT unset to avoid /tmp/ leak.
    _AUTO_BRIEF_TURN_FILE=""
    [ -n "${PROJECT_ROOT:-}" ] && _AUTO_BRIEF_TURN_FILE="${PROJECT_ROOT}/tmp/hme-turn-briefs.txt"
    if [ -n "$_AUTO_BRIEF_TURN_FILE" ] && [ -f "$_AUTO_BRIEF_TURN_FILE" ] \
        && grep -qFx "$_auto_module" "$_AUTO_BRIEF_TURN_FILE" 2>/dev/null; then
      _AUTO_BRIEF_SKIP=1
    fi
    if [ "${HME_AUTO_BRIEF_ON_EDIT:-1}" != "0" ] && [ -z "${_AUTO_BRIEF_SKIP:-}" ] \
        && [ -n "$_AUTO_BRIEF_TURN_FILE" ]; then
      # /enrich KB hits (~70ms) + head of target file. 500ms timeout
      # for CPU-saturated worker; brief is compact (<2 KB).
      # time. Healthy /enrich is ~70ms so the new ceiling is 7x headroom.
      _kb_hits=$(curl -sf --max-time 0.5 -X POST -H 'Content-Type: application/json' \
        --data-binary "{\"query\":\"${_auto_module}\",\"top_k\":3}" \
        "http://127.0.0.1:${HME_MCP_PORT:-9098}/enrich" 2>/dev/null \
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
      _file_head=$(head -n 30 "$FILE" 2>/dev/null | head -c 1200)
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
        printf '%s\n' "$_auto_module" >> "$_AUTO_BRIEF_TURN_FILE" 2>/dev/null
      fi
    fi
  fi
fi

# Record this edit's module for downstream gates (verify-landed antagonism, etc.). All blocking gates have passed.
if [ -n "$_MODULE_BASE" ] && [ -n "${PROJECT_ROOT:-}" ]; then
  mkdir -p "$(dirname "$_TURN_EDIT_STATE")" 2>/dev/null
  echo "$_MODULE_BASE" >> "$_TURN_EDIT_STATE"
fi

# streak helpers removed 2026-05-17 (5f0b98ef8); call sites pruned.
[ -n "$_AUTO_BRIEF_JSON" ] && printf '%s\n' "$_AUTO_BRIEF_JSON"
exit 0

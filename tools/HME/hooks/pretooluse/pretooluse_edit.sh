#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_onboarding.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_policy_enabled.sh" 2>/dev/null || true
# PreToolUse: Edit — ellipsis-stub block (true pre-execution reject) + onboarding
# warn. Activity emission, BRIEF check, and KB enrichment moved to proxy middleware.
INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
NEW_STRING=$(_safe_jq "$INPUT" '.tool_input.new_string' '')

# Coupling-aware antagonism warning: if this edit's module and a module
# edited earlier this turn are registered as a strong antagonist pair
# (r <= -0.3 in hme-coupling.json), surface it. The pair probably needs
# SEPARATE commits — antagonistic modules resist simultaneous change and
# commingling them masks which edit is responsible for a downstream drift.
# Observe-only warning (stderr); never blocks. Silent when no antagonists
# are registered (data-driven dormancy).
_TURN_EDIT_STATE="${PROJECT_ROOT:-}/tmp/hme-turn-edits.txt"
_MODULE_BASE=$(basename "$FILE" 2>/dev/null | sed 's/\.[^.]*$//')
if [ -n "$_MODULE_BASE" ] && [ -n "${PROJECT_ROOT:-}" ] && [ -f "${PROJECT_ROOT}/output/metrics/hme-coupling.json" ]; then
  # Check against prior edits this turn
  if [ -f "$_TURN_EDIT_STATE" ]; then
    while IFS= read -r _prior_mod; do
      [ -z "$_prior_mod" ] && continue
      [ "$_prior_mod" = "$_MODULE_BASE" ] && continue
      _AB_HIT=$(python3 - "$_MODULE_BASE" "$_prior_mod" "${PROJECT_ROOT}/output/metrics/hme-coupling.json" <<'PYEOF' 2>/dev/null
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
        echo "[hme] COUPLING WARNING: $_MODULE_BASE ↔ $_prior_mod are registered antagonists (r=$_AB_HIT). Consider separate commits — commingling antagonistic edits makes drift attribution harder." >&2
      fi
    done < "$_TURN_EDIT_STATE"
  fi
  # Record this edit for the rest of the turn
  mkdir -p "$(dirname "$_TURN_EDIT_STATE")" 2>/dev/null
  echo "$_MODULE_BASE" >> "$_TURN_EDIT_STATE"
fi

# Mid-pipeline src edit block. JS counterpart: block-mid-pipeline-write.
if _policy_enabled block-mid-pipeline-write && [ -f "${PROJECT_ROOT}/tmp/run.lock" ] && echo "$FILE" | grep -qE '/Polychron/src/'; then
  _emit_block "ABANDONED PIPELINE: npm run main is running (tmp/run.lock present). Do NOT edit src/ code mid-pipeline — the pipeline's behavior is being measured against the code state at launch. Wait for completion; use HME tools (i/learn, i/review, i/trace) or edit tooling/docs in the meantime."
  exit 2
fi

# Block direct edits to compiled output — edit the .ts source instead.
# JS counterpart: block-out-dir-writes.
if _policy_enabled block-out-dir-writes && echo "$FILE" | grep -q "tools/HME/chat/out/"; then
  cd "${PROJECT_ROOT}/tools/HME/chat" && npx tsc 2>&1 | tail -20 >&2 || true
  _emit_block "BLOCKED: Do NOT edit files in tools/HME/chat/out/ directly — edit the .ts source in tools/HME/chat/src/ instead. tsc has been run to compile any pending src/ changes."
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
  _emit_block "BLOCKED: Edit new_string contains comment-ellipsis stub placeholder. Use the ACTUAL replacement content — no stubs."
  exit 2
fi

# Hardcoded-project-root guard. Catches `/home/jah/Polychron` (or any
# absolute path matching the host's checkout) baked into source/script
# content. The proper resolution is `$PROJECT_ROOT` (set by .env load),
# `$CLAUDE_PROJECT_DIR` (Claude Code env var), or walk-up-from
# $BASH_SOURCE — never a hardcoded host-specific string.
#
# The guard is only meaningful when we know the actual project root to
# match against. In production hook invocation $PROJECT_ROOT is always
# set. The check matches against the LIVE PROJECT_ROOT to avoid false
# positives on someone else's checkout path.
if [ -n "${PROJECT_ROOT:-}" ] \
   && echo "$NEW_STRING" | grep -qF "$PROJECT_ROOT" \
   && echo "$FILE" | grep -qE '\.(sh|py|js|ts|tsx|mjs|cjs|json|yaml|yml|md)$' \
   && ! echo "$NEW_STRING" | grep -qE '"PROJECT_ROOT":[^,}]*"'"$PROJECT_ROOT"'"' \
   && ! echo "$FILE" | grep -qE '/(\.env|\.env\.[a-z]+|README|CLAUDE\.md|tools/HME/KB/devlog/|doc/archive/)$'; then
  _emit_block "BLOCKED: Edit new_string contains hardcoded project root '$PROJECT_ROOT'. Use \$PROJECT_ROOT (already set by .env via _safety.sh) or \$CLAUDE_PROJECT_DIR (Claude Code env var) — never a host-specific path. The .env file itself is the only legitimate place for the literal path; it's checked-in but each clone overrides it. Exempt files: README, CLAUDE.md, devlog snapshots."
  exit 2
fi

# Pre-save pattern lint — block new_string before it lands if it introduces
# forbidden patterns. Each block cites the rule + the fix, so the message
# alone is enough for the agent to correct the edit.
if echo "$FILE" | grep -qE '/Polychron/src/.*\.(js|ts|tsx|mjs|cjs)$'; then
  if echo "$NEW_STRING" | grep -qE '\bglobalThis\.|(^|[^a-zA-Z_])global\.[a-zA-Z_]'; then
    _emit_block "BLOCKED: new_string uses global. or globalThis. — 5 Core Principles #1 forbids these. Reference the global directly (declared in globals.d.ts)."
    exit 2
  fi
  if echo "$NEW_STRING" | grep -qE '\|\|[[:space:]]*(0|\[\]|\{\})([^a-zA-Z0-9_]|$)'; then
    _emit_block "BLOCKED: new_string uses || 0 / || [] / || {} fallback — 5 Core Principles #2 requires fail-fast. Use validator.optionalFinite(val, fallback) or validator.create('Module') + required checks."
    exit 2
  fi
  if echo "$NEW_STRING" | grep -qE '\.getSnapshot\(\)[[:space:]]*\.[[:space:]]*couplingMatrix'; then
    _emit_block "BLOCKED: new_string reads .couplingMatrix off getSnapshot() — forbidden outside coupling engine / meta-controllers (local/no-direct-coupling-matrix-read). Register a bias via conductorIntelligence instead."
    exit 2
  fi
  if echo "$NEW_STRING" | grep -qE '\bconsole\.warn\b' && ! echo "$NEW_STRING" | grep -qE "console\.warn\([^)]*['\"]Acceptable warning:"; then
    _emit_block "BLOCKED: console.warn without 'Acceptable warning:' prefix — CLAUDE.md Code Style rule. Format: console.warn('Acceptable warning: <message>')."
    exit 2
  fi
  if echo "$NEW_STRING" | grep -qE 'setBinaural\s*\(\s*([0-7](\.[0-9]+)?|1[3-9]|[2-9][0-9])\b'; then
    _emit_block "BLOCKED: setBinaural called outside alpha range 8–12Hz — Hard Rule (binaural is imperceptible neurostimulation only). Clamp to [8, 12]."
    exit 2
  fi

  # Semantic bugfix lookup — ask the worker if this module has a known bugfix
  # in KB that scores high against the current edit intent. High-confidence
  # hits (score ≥ 0.6) block: the edit is likely re-introducing a past bug.
  # Cache in /tmp by content hash so repeat attempts don't re-query.
  MODULE=$(basename "$FILE" | sed 's/\.[^.]*$//')
  if [ -n "$MODULE" ] && [ ${#NEW_STRING} -gt 20 ]; then
    HASH=$(printf '%s' "$NEW_STRING" | sha1sum | cut -c1-16)
    CACHE="/tmp/hme-edit-validate-$HASH.json"
    if [ ! -f "$CACHE" ]; then
      curl -s -m 2 -X POST "http://127.0.0.1:${HME_MCP_PORT:-9098}/validate" \
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
      _emit_block "BLOCKED: KB has a bugfix entry \"$BLOCK_HIT\" that strongly matches this module. Review it via learn(query='$MODULE') before editing — the edit may re-introduce a past bug."
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

# Unbriefed-edit detection + auto-brief injection.
#
# Prior design observed unbriefed edits (edit_without_brief event) but
# deliberately did NOT auto-fetch the brief — auto-BRIEFing was thought
# to defeat the read_coverage metric (which measures "did agent read
# before edit?"). The split below preserves the metric AND auto-injects:
#   - read_coverage / _nexus_has BRIEF: still ONLY incremented by an
#     explicit i/hme-read or equivalent. We do NOT call _brief_add here.
#   - auto-brief: fires when an unbriefed edit lands on a tracked path,
#     fetches a short module brief, and injects it as additionalContext
#     for Claude's next-turn context. Tracked separately as the
#     auto_brief_injected event (distinct from brief_recorded).
# Disable: HME_AUTO_BRIEF_ON_EDIT=0
_AUTO_BRIEF_JSON=""
if echo "$FILE" | grep -qE '/(src|tools/HME/(mcp|chat|activity|hooks|scripts|proxy|config))/'; then
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_nexus.sh"
  _auto_module=$(_extract_module "$FILE")
  if [ -n "$_auto_module" ] && ! _nexus_has BRIEF "$_auto_module"; then
    if [ -x "$PROJECT_ROOT/tools/HME/activity/emit.py" ]; then
      python3 "$PROJECT_ROOT/tools/HME/activity/emit.py" \
        --event=edit_without_brief \
        --file="$FILE" \
        --module="$_auto_module" \
        --session="$(whoami 2>/dev/null || echo shell)" \
        >/dev/null 2>&1 &
    fi
    # Per-turn dedup: re-firing the brief on every Edit to the same
    # module would re-issue /enrich + emit duplicate auto_brief_injected
    # events on each successive edit. The tracker is cleared at turn
    # start by userpromptsubmit.sh. Skip auto-brief entirely when
    # PROJECT_ROOT is unset (avoids leaking state to /tmp/ outside
    # any project).
    _AUTO_BRIEF_TURN_FILE=""
    [ -n "${PROJECT_ROOT:-}" ] && _AUTO_BRIEF_TURN_FILE="${PROJECT_ROOT}/tmp/hme-turn-briefs.txt"
    if [ -n "$_AUTO_BRIEF_TURN_FILE" ] && [ -f "$_AUTO_BRIEF_TURN_FILE" ] \
        && grep -qFx "$_auto_module" "$_AUTO_BRIEF_TURN_FILE" 2>/dev/null; then
      _AUTO_BRIEF_SKIP=1
    fi
    if [ "${HME_AUTO_BRIEF_ON_EDIT:-1}" != "0" ] && [ -z "${_AUTO_BRIEF_SKIP:-}" ] \
        && [ -n "$_AUTO_BRIEF_TURN_FILE" ]; then
      # Fast path: /enrich (~70ms) for KB hits + head of target file for
      # docstring/imports. Stays under the PreToolUse latency budget that
      # i/hme-read (15s LLM synthesis) blew. Brief is compact (<2 KB).
      _kb_hits=$(curl -sf --max-time 2 -X POST -H 'Content-Type: application/json' \
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
          python3 "$PROJECT_ROOT/tools/HME/activity/emit.py" \
            --event=auto_brief_injected \
            --file="$FILE" \
            --module="$_auto_module" \
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

_streak_tick 10
if ! _streak_check; then exit 1; fi
[ -n "$_AUTO_BRIEF_JSON" ] && printf '%s\n' "$_AUTO_BRIEF_JSON"
exit 0

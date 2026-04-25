#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# HME PreToolUse: Write — enforce lab rules, block memory saves, detect secrets
INPUT=$(cat)
FILE=$(_safe_jq "$INPUT" '.tool_input.file_path' '')
CONTENT=$(_safe_jq "$INPUT" '.tool_input.content' '')

# Mid-pipeline src edit block — if npm run main is running (run.lock exists),
# deny writes to src/ (composition code). Same rule as pretooluse_edit.sh.
if [ -f "${PROJECT_ROOT}/tmp/run.lock" ] && echo "$FILE" | grep -qE '/Polychron/src/'; then
  _emit_block "ABANDONED PIPELINE: npm run main is running (tmp/run.lock present). Do NOT write src/ code mid-pipeline — the pipeline's behavior is being measured against the code state at launch. Wait for completion; use HME tools or edit tooling/docs in the meantime."
  exit 2
fi

# Block direct writes to compiled output — edit the .ts source instead
if echo "$FILE" | grep -q "tools/HME/chat/out/"; then
  cd "${PROJECT_ROOT}/tools/HME/chat" && npx tsc 2>&1 | tail -20 >&2 || true
  _emit_block "BLOCKED: Do NOT write files in tools/HME/chat/out/ directly — edit the .ts source in tools/HME/chat/src/ instead. tsc has been run to compile any pending src/ changes."
  exit 2
fi

# Block writes to the auto-memory directory — HME KB is the canonical
# place for cross-session knowledge. Memory writes here are an
# antipattern: they're invisible to the rest of the system, can't be
# semantically searched, and accumulate without retirement.
if echo "$FILE" | grep -qE '\.claude/projects/.*/(memory/|MEMORY\.md)'; then
  _emit_block "BLOCKED: The .claude/projects memory directory is deprecated. Use HME KB instead: i/learn title=\"...\" content=\"...\" category=\"feedback\". Memories that point at behavioral rules belong in CLAUDE.md, not memory/."
  exit 2
fi

# Block writes to misplaced log/, metrics/, or tmp/ directories
if echo "$FILE" | grep -qE '/(log|tmp)/'; then
  if ! echo "$FILE" | grep -qE '^'"${PROJECT_ROOT}"'/(log|tmp)/'; then
    _emit_block "BLOCKED: log/ and tmp/ only exist at project root. Do not write files inside subdirectory variants. Route output through \$PROJECT_ROOT/{log,tmp}/."
    exit 2
  fi
fi
if echo "$FILE" | grep -qE '/metrics/'; then
  if ! echo "$FILE" | grep -qE '^'"${PROJECT_ROOT}"'/output/metrics/'; then
    _emit_block "BLOCKED: metrics/ only exists at output/metrics/. Do not write files in any other metrics/ directory."
    exit 2
  fi
fi

# Block writes to credential filenames. Filename-based check catches
# attempts to write `.pem`, `.key`, `id_rsa`, `id_ed25519`, `*.pfx`,
# `*.p12`, `credentials`, `service-account*.json`, `.npmrc` (auth tokens),
# `.pypirc` (auth tokens) regardless of the content. FailproofAI's
# `block-secrets-write` covers this; we extend our content-pattern detector
# below with filename detection so an `id_rsa` write attempt fails before
# any content inspection.
_BASENAME="$(basename "$FILE" 2>/dev/null)"
if echo "$_BASENAME" | grep -qiE '^(id_rsa|id_ed25519|id_ecdsa|id_dsa)(\.pub)?$|\.(pem|key|pfx|p12|jks)$|^credentials(\.json)?$|^service[-_]account.*\.json$|^\.npmrc$|^\.pypirc$|^\.netrc$'; then
  _emit_block "BLOCKED: writing to a credential filename ($_BASENAME). Polychron does not store keys, certs, or auth tokens in the repo. If this is a test fixture, name it with a non-credential prefix (e.g. fixture-*.pem); if it's an accidental real key, do NOT proceed."
  exit 2
fi

# Detect secret patterns in content (API keys, tokens, passwords)
if echo "$CONTENT" | grep -qE '(api[_-]?key|password|secret|token)[[:space:]]*[:=][[:space:]]*[A-Za-z0-9+/]{20,}'; then
  _emit_block "BLOCKED: Potential secret/credential detected in write content. Review before writing."
  exit 2
fi

# Block stub/placeholder writes — LLM-generated code with comment-ellipsis elision patterns
# destroys files by replacing real content with placeholder references.
if echo "$CONTENT" | grep -qiE '(#|//|/\*)[[:space:]]*(\.\.\.)?[[:space:]]*(existing|rest of|previous)[[:space:]]+(code|file|implementation|content|functions?)[[:space:]]*(\.\.\.)?'; then
  _emit_block "BLOCKED: Write contains comment-ellipsis stub placeholder. This destroys files. Write the COMPLETE file content or use Edit for partial changes."
  exit 2
fi
if echo "$CONTENT" | grep -qE '\.\.\. rest of (file|implementation|code)'; then
  _emit_block "BLOCKED: Write contains ellipsis-rest-of stub placeholder. Write complete content or use Edit."
  exit 2
fi

if echo "$FILE" | grep -q 'lab/sketches.js'; then
  echo 'LAB RULES: Every postBoot() must create AUDIBLE behavior via real monkey-patching. No empty sketches. Do not use V (validator) -- use Number.isFinite directly. Do not use crossLayerHelpers -- use inline layer logic. Do not return values from void functions (playNotesEmitPick returns void).' >&2
fi
# fix_antipattern: expected background failures must be logger.info, not logger.warning.
# Only genuine critical failures (interactive timeout, HTTP 500, connection refused) stay as warning.
# Catches: logger.warning(...background...) and logger.warning(...warm...failed/error...) in HME server code.
if echo "$FILE" | grep -q 'tools/HME/mcp/server'; then
  if echo "$CONTENT" | grep -qE 'logger\.warning\(.*\b(background|warm.*fail|warm.*error|onnx.*failed|VRAM TIGHT|lazy warm)\b'; then
    _emit_block "BLOCKED: Expected background failure logged as WARNING — use logger.info. Only critical failures (interactive timeout, HTTP 500) should be WARNING in HME server. See ANTIPATTERN: stderr-to-UI popup spam."
    exit 2
  fi
fi
# Enrich: semantic-validate src/ writes via /validate. Blocks on high-confidence
# bugfix match (score ≥ 0.6); emits category-aware enrichment notice on warnings.
if echo "$FILE" | grep -qE '/Polychron/src/'; then
  MODULE=$(_extract_module "$FILE")
  VAL_CACHE="/tmp/hme-write-validate-$(printf '%s' "$MODULE" | sha1sum | cut -c1-16).json"
  if [ ! -f "$VAL_CACHE" ]; then
    curl -s -m 2 -X POST "http://127.0.0.1:${HME_MCP_PORT:-9098}/validate" \
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
    _emit_enrich_allow "Writing to $MODULE — KB rules/antipatterns may apply:
$WARN_TITLES"
    _streak_tick 10
    exit 0
  fi
fi
# Auto-brief on Write (mirror of pretooluse_edit.sh): inject hme-read
# brief as additionalContext when target lives under a tracked tree and
# hasn't been BRIEFed yet. Does NOT mark BRIEF — preserves read_coverage
# metric semantics. Emits auto_brief_injected for separate tracking.
# Disable: HME_AUTO_BRIEF_ON_EDIT=0
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
      # Fast path via /enrich (~70ms) + file head — same budget as
      # pretooluse_edit.sh. Write may target a new file (head empty);
      # KB hits alone are still useful in that case.
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
          python3 "$PROJECT_ROOT/tools/HME/activity/emit.py" \
            --event=auto_brief_injected \
            --file="$FILE" \
            --module="$_auto_module" \
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

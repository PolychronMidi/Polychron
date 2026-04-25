#!/usr/bin/env bash
# Direct-mode dispatcher — runs lifecycle hooks WITHOUT the proxy daemon.
# Mirrors the routing logic in tools/HME/proxy/hook_bridge.js so every
# lifecycle event survives a proxy outage. Invoked by _proxy_bridge.sh's
# fallback path when the proxy POST fails.
#
# Architectural intent (lesson #1 — filesystem-IPC philosophy): the proxy
# is an accelerator (keeps Lance + LLM clients warm, runs middleware), not
# a single point of failure. Every hook continues firing even when the
# proxy is dead — degraded enrichment, full safety semantics.
#
# Usage:   $0 <EventName> < stdin-payload
# Outputs: stdout = decision JSON or hookSpecificOutput (or empty for allow)
#          stderr = informational text
#          exit 0 always (a chain crash should not wedge the agent)
#
# What's degraded vs proxy-mode:
#   - No middleware (memory_redirect, edit_context, secret_sanitizer,
#     dominance_response_rewriter, bash_enrichment, etc.). Tool results
#     reach Claude Code without HME enrichment / sanitization.
#   - No `pretooluse_hme_primer.sh` injection for HME_-prefixed tools.
#     If the next event after a proxy outage is an HME_* tool call, the
#     primer won't fire — but the proxy-up path will reinstate it.
#   - The Stop chain runs via the JS CLI which has its own minimal
#     dominance handling (none — block decisions go raw).
#
# What's preserved:
#   - All bash-side gates (run.lock guard, write blocks, hme_dispatch,
#     blackbox guards, polling counters, etc.)
#   - Nexus state tracking (EDIT/BRIEF/REVIEW markers via posttooluse)
#   - Activity event emission (already filesystem-IPC via emit.py)

set +u +e

EVENT="${1:-unknown}"
PROJECT_ROOT="${PROJECT_ROOT:-/home/jah/Polychron}"
HOOKS_DIR="$PROJECT_ROOT/tools/HME/hooks"
PRETOOLUSE_DIR="$HOOKS_DIR/pretooluse"
POSTTOOLUSE_DIR="$HOOKS_DIR/posttooluse"
LIFECYCLE_DIR="$HOOKS_DIR/lifecycle"

BODY=$(cat)

# Run a single bash hook with $BODY on stdin. Captures stdout, passes
# stderr through. Returns the script's exit code.
_run() {
  local script="$1"
  [ -f "$script" ] || return 0
  printf '%s' "$BODY" | bash "$script" 2>&2
  return $?
}

# Run a chain of hooks. Concatenates stdout. First block decision wins
# (subsequent scripts skipped) — mirrors hook_bridge.js runChain() shape.
_run_chain() {
  local scripts=("$@")
  local out_all=""
  local out
  local rc
  for s in "${scripts[@]}"; do
    [ -f "$s" ] || continue
    out=$(printf '%s' "$BODY" | bash "$s" 2>&2)
    rc=$?
    out_all+="$out"
    if echo "$out" | grep -q '"decision"[[:space:]]*:[[:space:]]*"block"'; then
      break
    fi
  done
  printf '%s' "$out_all"
}

case "$EVENT" in
  Stop)
    # Stop chain has a JS evaluator with policy semantics; delegate to its CLI.
    printf '%s' "$BODY" | node "$PROJECT_ROOT/tools/HME/proxy/stop_chain/cli.js"
    ;;

  SessionStart)
    _run "$LIFECYCLE_DIR/sessionstart.sh"
    ;;

  UserPromptSubmit)
    _run "$LIFECYCLE_DIR/userpromptsubmit.sh"
    ;;

  PreCompact)
    _run "$LIFECYCLE_DIR/precompact.sh"
    ;;

  PostCompact)
    _run "$LIFECYCLE_DIR/postcompact.sh"
    ;;

  PreToolUse)
    TOOL_NAME=$(echo "$BODY" | jq -r '.tool_name // ""' 2>/dev/null)
    case "$TOOL_NAME" in
      Edit|MultiEdit) _run "$PRETOOLUSE_DIR/pretooluse_edit.sh" ;;
      Write)          _run "$PRETOOLUSE_DIR/pretooluse_write.sh" ;;
      Bash)           _run "$PRETOOLUSE_DIR/pretooluse_bash.sh" ;;
      Read)           _run "$PRETOOLUSE_DIR/pretooluse_read.sh" ;;
      Grep)           _run "$PRETOOLUSE_DIR/pretooluse_grep.sh" ;;
      Glob)           _run "$PRETOOLUSE_DIR/pretooluse_glob.sh" ;;
      TodoWrite)      _run "$PRETOOLUSE_DIR/pretooluse_todowrite.sh" ;;
      ToolSearch)     _run "$PRETOOLUSE_DIR/pretooluse_toolsearch.sh" ;;
      *)              : ;;  # no pretool hook for this tool
    esac
    ;;

  PostToolUse)
    TOOL_NAME=$(echo "$BODY" | jq -r '.tool_name // ""' 2>/dev/null)
    # Universal log-tool-call always runs; tool-specific scripts after.
    SCRIPTS=("$HOOKS_DIR/log-tool-call.sh")
    case "$TOOL_NAME" in
      Bash)
        SCRIPTS+=("$POSTTOOLUSE_DIR/posttooluse_bash.sh")
        SCRIPTS+=("$POSTTOOLUSE_DIR/posttooluse_pipeline_kb.sh")
        ;;
      Edit|MultiEdit|Write)
        SCRIPTS+=("$POSTTOOLUSE_DIR/posttooluse_edit.sh")
        ;;
      Read)
        SCRIPTS+=("$POSTTOOLUSE_DIR/posttooluse_read_kb.sh")
        ;;
      TodoWrite)
        SCRIPTS+=("$POSTTOOLUSE_DIR/posttooluse_todowrite.sh")
        ;;
    esac
    _run_chain "${SCRIPTS[@]}"
    ;;

  *)
    echo "[direct_dispatch] unknown event: $EVENT" >&2
    ;;
esac

exit 0

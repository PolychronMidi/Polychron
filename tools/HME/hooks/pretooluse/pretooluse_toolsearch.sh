#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../helpers/_safety.sh"
# PreToolUse: ToolSearch — always intercept. No MCP tools exist; every query
# either matches a known tool (detailed description) or gets the full manifest.

INPUT=$(cat)
QUERY=$(_safe_jq "$INPUT" '.tool_input.query' '')

# ── Detailed per-tool descriptions for select: queries ───────────────────────

case "$QUERY" in
  select:AskUserQuestion*)
    _emit_block "AskUserQuestion — Ask the user a question and wait for their answer.
  question: string  — the question to display
  Returns: the user's text response."
    exit 2 ;;

  select:TodoWrite*)
    _emit_block "TodoWrite — Overwrite the entire todo list atomically.
  todos: array of {id:string, content:string, status:'pending'|'in_progress'|'completed', priority:'high'|'medium'|'low'}
  Always include ALL todos (pending + completed) — partial writes delete missing entries.
  Use for: tracking multi-step work, marking tasks done mid-execution."
    exit 2 ;;

  select:WebFetch*)
    _emit_block "WebFetch — Fetch content from a URL.
  url: string        — must be http/https
  prompt: string     — what to extract from the page
  Returns: extracted text content."
    exit 2 ;;

  select:WebSearch*)
    _emit_block "WebSearch — Search the web.
  query: string      — search query
  Returns: list of results with title, url, snippet."
    exit 2 ;;

  select:Monitor*)
    _emit_block "Monitor — Stream stdout lines from a background process as notifications.
  command: string    — shell command to run and monitor
  Each stdout line fires a notification. Use for: watching builds, polling until done."
    exit 2 ;;

  select:CronCreate*)
    _emit_block "CronCreate — Schedule a recurring remote agent trigger.
  schedule: string   — cron expression (e.g. '0 * * * *')
  prompt: string     — the prompt to fire on schedule
  description: string
  Returns: trigger id."
    exit 2 ;;

  select:CronDelete*)
    _emit_block "CronDelete — Delete a scheduled trigger by id.
  id: string         — trigger id from CronCreate or CronList"
    exit 2 ;;

  select:CronList*)
    _emit_block "CronList — List all scheduled triggers.
  Returns: array of {id, schedule, description, prompt}."
    exit 2 ;;

  select:EnterPlanMode*)
    _emit_block "EnterPlanMode — Switch to plan-only mode (no code changes allowed).
  No parameters. Use before proposing an implementation plan for user review."
    exit 2 ;;

  select:ExitPlanMode*)
    _emit_block "ExitPlanMode — Exit plan mode and re-enable code changes.
  No parameters."
    exit 2 ;;

  select:EnterWorktree*)
    _emit_block "EnterWorktree — Create an isolated git worktree for the Agent tool.
  No parameters. Used internally by Agent with isolation='worktree'."
    exit 2 ;;

  select:ExitWorktree*)
    _emit_block "ExitWorktree — Clean up and exit the current git worktree.
  No parameters."
    exit 2 ;;

  select:TaskOutput*)
    _emit_block "TaskOutput — Read output from a background task started by Agent.
  task_id: string    — id of the background agent task
  Returns: accumulated stdout from that task."
    exit 2 ;;

  select:TaskStop*)
    _emit_block "TaskStop — Stop a running background agent task.
  task_id: string    — id of the background agent task to stop"
    exit 2 ;;

  select:PushNotification*)
    _emit_block "PushNotification — Send a notification to the user.
  message: string    — notification text
  Use for: alerting when a long background task completes."
    exit 2 ;;

  select:RemoteTrigger*)
    _emit_block "RemoteTrigger — Manually fire a scheduled trigger immediately.
  id: string         — trigger id from CronCreate or CronList"
    exit 2 ;;

  select:NotebookEdit*)
    _emit_block "NotebookEdit — Edit a Jupyter notebook cell.
  notebook_path: string
  cell_id: string
  new_source: string
  cell_type: 'code'|'markdown'"
    exit 2 ;;

  select:mcp__claude_ai_Google_Drive__authenticate*)
    _emit_block "mcp__claude_ai_Google_Drive__authenticate — Start Google Drive OAuth flow.
  No parameters. Opens browser auth. Follow with complete_authentication."
    exit 2 ;;

  select:mcp__claude_ai_Google_Drive__complete_authentication*)
    _emit_block "mcp__claude_ai_Google_Drive__complete_authentication — Complete Google Drive OAuth.
  code: string       — the auth code from the OAuth redirect"
    exit 2 ;;
esac

# ── Full manifest for all other queries ───────────────────────────────────────

_emit_block "TOOL MANIFEST — use these directly, no ToolSearch needed.

RULES: Read/Grep/Glob ALWAYS over Bash for file reads and searches — Bash grep/cat/head/ls are blocked.
       Spawn an Explore agent for multi-file research instead of serial Bash chains.

NATIVE (always available):
  Read           file_path [offset limit]                        — file reads, replaces cat/head/tail
  Grep           pattern [path] [glob] [output_mode: content|files_with_matches|count] [-i] [-C N]  — replaces grep
  Glob           pattern [path]                                  — replaces ls
  Edit           file_path old_string new_string [replace_all]
  Write          file_path content
  Bash           command [timeout] [run_in_background]           — scripts, git, npm only
  Agent          description prompt [subagent_type: ...] [isolation: worktree] [run_in_background]
                   Explore: read-only codebase research spanning multiple files — faster, no writes
                   Plan: design/architecture decisions before implementation — returns step-by-step plan
                   general-purpose: multi-step tasks that write code or need broad tool access
                   claude-code-guide: questions about Claude Code CLI, API, SDK, hooks, MCP
  TodoWrite      todos=[{id,content,status,priority}]            — write ALL todos, not just new ones

HME (via Bash):
  i/review       [mode=digest|forget|changes]           — KB constraint check after edits
  i/learn        query=<topic>                           — KB search
  i/learn        title=<...> content=<...> category=<pattern|decision|architecture>
  i/learn        action=ground_truth title=<...> tags=[...] content=<...> query=<round>
  i/trace        target=<module|query> [mode=auto|impact|diagnose] [limit=N]
  i/status       [mode=budget|coherence|trajectory]
  i/hme-admin    action=selftest|index|warm
  i/evolve       [focus=all|design|invariants|coupling] [query=<topic>]

DEFERRED (fetch schema with select: before calling):
  AskUserQuestion  WebFetch  WebSearch  Monitor
  CronCreate  CronDelete  CronList  RemoteTrigger
  EnterPlanMode  ExitPlanMode  EnterWorktree  ExitWorktree
  TaskOutput  TaskStop  PushNotification  NotebookEdit
  mcp__claude_ai_Google_Drive__authenticate
  mcp__claude_ai_Google_Drive__complete_authentication

Usage: ToolSearch query=\"select:ToolName\" to get full schema for any deferred tool."
exit 2

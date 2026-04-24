# Dispatch HME shell-wrapper pre-hooks. These used to be triggered by MCP
# matchers in hooks.json (mcp__HME__* PreToolUse); now HME tools run via
# Bash(i/<tool>) shell wrappers and the dispatch happens here. The handler
# scripts read stdin (the same hook JSON) and emit their own jq blocks when
# they want to deny/redirect the call.

# Pipeline-status polling guard — fires on `i/status`.
# Match form: `i/status`, `./i/status`, `bash i/status`, etc.
if echo "$CMD" | grep -qE '(^|[[:space:]/])i/status\b'; then
  echo "$INPUT" | bash "$SCRIPT_DIR/pretooluse_check_pipeline.sh" || true
fi
# Agent primer — fires on FIRST HME tool call of a session (any i/<hme-tool>).
if echo "$CMD" | grep -qE '(^|[[:space:]/])i/(review|learn|trace|evolve|hme-admin|status|todo|hme-read|hme)\b|scripts/hme-cli\.js'; then
  echo "$INPUT" | bash "$SCRIPT_DIR/pretooluse_hme_primer.sh" || true
fi

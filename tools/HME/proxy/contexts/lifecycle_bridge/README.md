# lifecycle_bridge/

Bounded-context façade: maps Claude Code lifecycle events (PreToolUse,
PostToolUse, SessionStart, Stop, UserPromptSubmit) into the portable
event kernel. Public surface re-exported from `proxy/lifecycle_bridge.js`.
See `doc/PROXY_CONTEXTS.md`.

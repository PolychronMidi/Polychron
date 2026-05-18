# pretooluse_bash gate convention

`pretooluse_bash.sh` auto-loads gates by phase via `bash/<phase>/*.sh`:

- `pre/` — runs BEFORE the bash-command policy block. Use this when the
  policy's allow-and-exit short-circuit would otherwise bypass the gate
  (e.g. petulance, no-op spirals). Sourced in lexical order.
- `post/` — runs AFTER the policy block. Use this for refinements that
  only matter for commands the policy already permitted.
- `_disabled/` — gates that were previously orphaned (never sourced by
  any dispatcher). Each one needs an audit before being re-enabled
  via `pre/` or `post/`. Do NOT enable wholesale.

Each gate is sourced in the parent shell, so:
- can read `$INPUT` / `$CMD` / hook helpers (`_safe_jq`, `_emit_block`, ...)
- exits with `return 0`/`return 2` (or `exit 0`/`exit 2`)
- non-zero/non-2 rc is logged to `log/hme-errors.log`

A gate that wants to deny prints a JSON `permissionDecision:"deny"` envelope
and exits 0 (Claude Code reads stdout, hook process succeeded).

# Canonical System Prompt

> **Official alternative shipped:** `.claude/output-styles/polychron-trimmed.md`
> mirrors this canonical content as an Anthropic-supported [Output Style](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts).
> Activate in interactive Claude Code via `/output-style polychron-trimmed`.
> Output Styles is the blessed mechanism for system-prompt replacement —
> won't break on Claude Code updates and works without the proxy.
> The proxy-based `replace_system.js` remains active as a parallel path
> (covers cases where Claude Code is invoked outside the workspace, e.g.
> `claude -p` subprocesses with `ANTHROPIC_BASE_URL` set). The proxy's
> unique value is `filter_tools.js` — Output Styles does NOT filter the
> tools array.


`canonical-system-prompt.md` is the project-curated system prompt that
replaces Claude Code's default when `HME_REPLACE_SYSTEM_PROMPT=1` in
`.env`. The replacement is wholesale — Anthropic can rephrase or
restructure their default at will and our content still ships verbatim,
no regex anchors to drift.

Mechanism: [`tools/HME/proxy/middleware/replace_system.js`](middleware/replace_system.js).
mtime-cached, so edits to the canonical file take effect on the next
proxy-routed request after save (no proxy restart needed).

## Bootstrap origin

Bootstrapped from a captured dump of Claude Code's default prompt with
the following sections removed (each was identified as either
HME-superseded, unrelated to this project, or pure boilerplate that
doesn't shape behavior):

- `# auto memory` section (~12.5KB) — HME's KB (`i/learn`) supersedes
- `gitStatus:` trailing block — agent has the `git` tool, can pull current state directly
- `/schedule` offer bullet — quasi-promotional, the agent can `/schedule` itself
- `/ultrareview` explainer — feature mention without behavioral effect
- UI/frontend dev-server bullet — Polychron is audio synthesis, no browser UI
- `/help` + feedback-URL bullets — onboarding boilerplate
- Fast mode (Opus 4.6) line — model-specific footnote
- "Claude Code is available as a CLI/desktop/..." marketing line
- Model-ID enumeration — agent IS one of these models, redundant

## Editing

Edit `canonical-system-prompt.md` directly. Every byte goes verbatim to
the model as the system prompt — no comments, no markers, no header.

## Inspecting Claude Code's current default

If Anthropic ships a new prompt structure and you want to refresh the
canonical:

1. `HME_DUMP_SYSTEM_PROMPT=1` in `.env`
2. Restart proxy
3. Fire any request through the proxy (e.g.,
   `ANTHROPIC_BASE_URL=http://127.0.0.1:9099 claude -p "ping"`)
4. Inspect `tmp/claude-system-prompt.txt` (system block only) AND
   `tmp/claude-full-payload.json` (full request: system + tools + params)
5. Restore `HME_DUMP_SYSTEM_PROMPT=0`

The dump captures pre-replacement state (dump_system runs before
replace_system in the middleware order).

## Filtering tools (separate, bigger lever)

The `tools` array on every request is ~60KB+ — bigger than the system
prompt. If you have tools you never use (`mcp__claude_ai_Google_Drive__*`,
`EnterWorktree`/`ExitWorktree`, `Monitor`, `RemoteTrigger`, `WebFetch`,
`WebSearch`, `CronCreate`/`Delete`/`List`, `PushNotification`, etc.),
drop them via [`filter_tools.js`](middleware/filter_tools.js):

```
# In .env — comma-separated, exact tool names
HME_FILTER_TOOLS_DROP=mcp__claude_ai_Google_Drive__authenticate,mcp__claude_ai_Google_Drive__complete_authentication,EnterWorktree,ExitWorktree,Monitor,RemoteTrigger,WebFetch,WebSearch,CronCreate,CronDelete,CronList,PushNotification
```

**Removing a tool means the agent cannot call it** — verify your
workflow doesn't need it before adding to the list. To see the current
tool surface, run the inspection workflow above and check the
`tools[].name` list in `tmp/claude-full-payload.json`.

Empirical baseline: dropping the 12 listed above saved 23,316 bytes
(~23KB) per request when measured against a captured Claude Code
payload — roughly 2x the savings of pruning the `# auto memory` section.

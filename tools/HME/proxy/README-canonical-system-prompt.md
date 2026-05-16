# Canonical System Prompt

`canonical-system-prompt.md` is the project-curated system prompt that
replaces Claude Code's default when `HME_REPLACE_SYSTEM_PROMPT=1` in
`.env`. The replacement is wholesale -- Anthropic can rephrase or
restructure their default at will and our content still ships verbatim,
no regex anchors to drift.

Codex uses the same file through a generated model catalog. Run
`tools/HME/scripts/sync-codex-settings.py` to regenerate
`runtime/hme/codex-model-catalog.json` from `~/.codex/models_cache.json` and
point Codex's `model_catalog_json` at the generated catalog.

Mechanism: [`tools/HME/proxy/middleware/01_replace_system.js`](middleware/01_replace_system.js).
mtime-cached, so edits to the canonical file take effect on the next
proxy-routed request after save (no proxy restart needed).

## What's in the canonical (and why)

15 lines / ~1.8KB -- down 93% from Claude Code's ~28KB default block 2.
Only content that the system-prompt layer can do (because doc/templates/AGENTS.md and
HME hooks can't):

1. Identity statement + pointer to doc/templates/AGENTS.md and HME hooks as the
   authority for project-specific behavior
2. Two `IMPORTANT:` security directives -- refusal-policy text from
   Anthropic that triggers refusals during reasoning, not just shaping
3. Output channel awareness (text outside tool calls is user-facing,
   markdown rendering, no-colon-before-tool-call convention)
4. `<system-reminder>` tag awareness -- load-bearing for HME hooks to
   inject directives the agent will act on
5. Hook-as-user-input mapping -- without this the agent doesn't know how
   to interpret hook block messages
6. Prompt-injection awareness on tool_results from external sources
7. Permission-mode awareness (denied calls shouldn't be retried verbatim)
8. Auto-compaction awareness (older context may be summarized)

Everything else (style, code conventions, refactor discipline, comment
policy, end-of-turn discipline, system-reminder priority, plan
adherence, Hypermeta workflow, etc.) is owned by `doc/templates/AGENTS.md` (auto-loaded
into context) and HME's hook layer (proxy middleware + stop-chain
detectors like `exhaust_check` and `psycho_stop`, plus the `trample_gate`
proxy middleware for request-time interrupt-ack).

## Editing

Edit `canonical-system-prompt.md` directly. Every byte goes verbatim to
the model as the system prompt -- no comments, no markers, no header.
Keep additions narrow: anything doc/templates/AGENTS.md or a hook can enforce belongs
there, not here. The system prompt is reserved for things only the
system prompt can do.

## Inspecting Claude Code's current default

If Anthropic ships a new prompt structure and you want to refresh the
canonical:

1. `HME_DUMP_SYSTEM_PROMPT=1` in `.env`
2. Restart proxy
3. Fire any request through the proxy (e.g.,
   `ANTHROPIC_BASE_URL=http://127.0.0.1:${HME_PROXY_PORT:-9099} claude -p "ping"`)
4. Inspect `tmp/claude-system-prompt.txt` (system block only) AND
   `tmp/claude-full-payload.json` (full request: system + tools + params)
5. Restore `HME_DUMP_SYSTEM_PROMPT=0`

The dump captures pre-replacement state (dump_system runs before
replace_system in the middleware order).

## Filtering tools (separate, bigger lever)

The `tools` array on every request is ~60KB+ -- bigger than the system
prompt. If you have tools you never use (`mcp__claude_ai_Google_Drive__*`,
`EnterWorktree`/`ExitWorktree`, `Monitor`, `RemoteTrigger`, `WebFetch`,
`WebSearch`, `CronCreate`/`Delete`/`List`, `PushNotification`, etc.),
drop them via [`filter_tools.js`](middleware/03_filter_tools.js):

```
# In .env -- comma-separated, exact tool names
HME_FILTER_TOOLS_DROP=mcp__claude_ai_Google_Drive__authenticate,mcp__claude_ai_Google_Drive__complete_authentication,EnterWorktree,ExitWorktree,Monitor,RemoteTrigger,WebFetch,WebSearch,CronCreate,CronDelete,CronList,PushNotification
```

**Removing a tool means the agent cannot call it** -- verify your
workflow doesn't need it before adding to the list. To see the current
tool surface, run the inspection workflow above and check the
`tools[].name` list in `tmp/claude-full-payload.json`.

Empirical baseline (current setup, measured end-to-end against a real
captured Claude Code request):

| | Raw default | Trimmed canonical + filter_tools |
|---|---|---|
| `system` block | 27,785B | 1,817B (93% smaller) |
| `tools` array | 79,566B (26 entries) | 57,061B (14 entries -- 12 dropped) |
| **Total payload** | **134,596B** | **~92KB (32% smaller)** |

# Canonical System Prompt

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
4. Inspect `tmp/claude-system-prompt.txt`
5. Restore `HME_DUMP_SYSTEM_PROMPT=0`

The dump captures pre-replacement state (dump_system runs before
replace_system in the middleware order).

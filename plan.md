# OMO universal host-hook source-of-truth plan

Status: complete.

Goal: make `tools/HME/hooks` the definitive source for Claude/Codex hook routing so home-level host configs are disposable materialized adapters, not policy sources.

## Completed work

1. Canonical hook source
   - `tools/HME/hooks/hooks.json` is the source of truth for managed host hook layout.
   - `tools/HME/hooks/codex-extensions.json` contains only Codex-specific extension events.

2. Single host entrypoint
   - Added `tools/HME/event_kernel/host_hook_entry.js`.
   - Claude commands route through `host_hook_entry.js --host claude --event ...`.
   - Codex commands route through `host_hook_entry.js --host codex --event ...`.
   - Host entrypoint delegates to host adapters; policy routing remains in `event_kernel/dispatcher.js` and `tools/HME/hooks`.

3. Host config materialization
   - Claude settings are projected by `tools/HME/scripts/sync-claude-settings.py` from `tools/HME/hooks/hooks.json`.
   - Codex hooks/config are projected by `tools/HME/scripts/sync-codex-settings.py` from `tools/HME/hooks/hooks.json` plus `codex-extensions.json`.
   - Live `~/.claude/settings.json` and `~/.codex/hooks.json` were synced from HME-managed sources.

4. Drift checks
   - `sync-claude-settings.py --check` reports zero drift.
   - `sync-codex-settings.py --check` reports zero drift.
   - `audit-claude-settings.py --json` reports zero violations.
   - `audit-codex-settings.py --json` reports zero violations.

5. Regression tests
   - Added `tools/HME/tests/specs/host_hook_materialization.test.py`.
   - It proves:
     - managed hooks route through `event_kernel/host_hook_entry.js`;
     - Claude projection uses `--host claude`;
     - Codex projection uses `--host codex`;
     - direct `claude_adapter.js` / `codex_adapter.js` commands do not leak into materialized hook commands;
     - direct `tools/HME/hooks/pretooluse` / `posttooluse` script paths do not leak into home config projection.

6. OMO/focused verification
   - OMO and universal hook focused suite passes.
   - Host materialization tests pass.
   - Env/settings tests pass.

## Invariants now enforced

- Home configs are generated artifacts.
- HME hook policy lives under `tools/HME/hooks`, `tools/HME/event_kernel`, and OMO bridge modules.
- Claude/Codex configs contain only stable HME entrypoint commands, not individual policy script routing.
- Host-specific behavior stays in adapters/materializers; policy selection remains HME-owned.

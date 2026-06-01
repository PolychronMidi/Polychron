Bridge between HME and oh-my-openagent/OpenCode-compatible hook surfaces.

The bridge owns `hme-opencode-hook/v1` as HME's universal hook ABI:

- OpenCode-compatible core phases: `chat.params`, `permission.ask`, `tool.execute.before`, `tool.execute.after`.
- HME extension phases: `stop.before`, `stream.text_block`.
- Validators live in `universal_event.js`, `universal_decision.js`, and `contract_validator.js`.

See `doc/hme-opencode-universal-hook-abi.md` for the migration contract.

OpenCode routing is wired through `shadow_runtime.js` and
`event_kernel/dispatcher.js`. Enable observation mode with:

- `HME_OMO_ENABLED=1`
- `HME_OMO_MODE=shadow`
- `HME_OMO_SOURCE=path` and `HME_OMO_PATH=tools/oh-my-openagent`, or `HME_OMO_SOURCE=package` with `HME_OMO_PACKAGE=oh-my-openagent`
- optional `HME_OMO_REQUIRED_VERSION`
- optional `HME_OMO_TIMEOUT_MS`
- optional per-phase timeouts such as `HME_OMO_TIMEOUT_TOOL_EXECUTE_BEFORE_MS`
- optional `HME_OMO_PHASES=tool.execute.after,session.start` to observe only selected phases
- optional `HME_OMO_PRELOAD=0` to disable SessionStart runtime warmup
- optional `HME_OMO_TOOL_BEFORE_WARM_ONLY=1` to skip cold `tool.execute.before` observation until OMO is preloaded

Shadow observations are fail-open. Missing OMO builds, load failures, invalid
events, plugin errors, and timeouts are emitted as `omo_shadow_observed`
telemetry and never change HME/OpenCode hook decisions.

Live application is separately opt-in:

- `HME_OMO_ENABLED=1`
- `HME_OMO_MODE=live`
- the same source, timeout, phase allowlist, preload, and warm-only controls used by shadow mode

Live mode currently applies only decisions that HME can safely translate back to
host hook output:

- `tool.execute.before` / `PreToolUse`: `deny` and `modify` with target `tool.input`.
- `permission.ask` / `PermissionRequest`: `deny`.
- `stop.before` / `Stop`: `deny`, only if HME's stop-chain did not already block.

All live OMO failures remain fail-open. Dependency errors, invalid events,
timeouts, plugin errors, and unsupported decisions fall through to HME's native
hook chain. HME still runs downstream validation on modified tool input before
returning an OMO modification to the host.

For the installed npm package in this workspace, use `HME_OMO_SOURCE=package`
and `HME_OMO_PACKAGE=oh-my-openagent`; the built entrypoint is
`node_modules/oh-my-openagent/dist/index.js`. Cold `tool.execute.before`
initialization can take multiple seconds, so use a larger shadow budget such as
`HME_OMO_TIMEOUT_MS=10000` for real-entrypoint smoke tests.

Compact shadow rows are appended to `omo-shadow-decisions.jsonl` under the HME
runtime directory. Summarize them with:

`node tools/HME/scripts/omo-shadow-status.js --limit 200`

Use the same script as a health gate, for example:

`node tools/HME/scripts/omo-shadow-status.js --fail-on-unhealthy --max-timeout-rate 0.05 --max-p95-ms 1000`

HME keeps final authority over denials, stop-chain, permission, secret/path,
provider routing, stream rewriting, and capability filtering. OMO live decisions
are translated into HME-owned hook responses, never returned directly to the
host.

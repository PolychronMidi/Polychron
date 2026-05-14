# HME Full Reference

Detailed reference for `tools/HME/`, distilled from the former per-topic docs.
Keep this as the single source of truth for HME architecture, lifecycle
behavior, state ownership, local inference, self-coherence, and operational
runbooks.

## Mental Model

HME watches two coherences at once:

- **Musical coherence:** what the composition did, measured through pipeline
  metrics and fingerprint verdicts.
- **Self-coherence:** whether HME's own rules, docs, tools, state, and
  measurements still describe reality.

The agent acts through native tools and `i/` commands. The proxy, event kernel,
hooks, policies, worker, KB, and verifiers convert those actions into a
measured evolution loop.

## Surfaces

- `i/` wrappers: deliberate HME commands.
- Native Read/Edit/Grep/Glob/TodoWrite: enriched or replaced by proxy
  middleware where appropriate.
- Proxy middleware: transforms inference and native-tool results.
- Event kernel: portable routing for lifecycle and tool events.
- Hooks: host-specific adapters and remaining shell lifecycle stages.
- Worker service: KB, review, learn, trace, status, policies, admin actions.
- Metrics: JSON/JSONL state in `output/metrics/`, `tmp/`, `runtime/hme/`, and
  `log/`.

## Event Kernel

`tools/HME/event_kernel/dispatcher.js` is the canonical event router. Adapters
handle transport only.

```text
Claude Code event
  -> event_kernel/claude_adapter.js
     -> proxy /hme/lifecycle when proxy is up
     -> dispatcher directly when proxy is down
  -> event_kernel/dispatcher.js
     -> native JS handlers, shell stages, or Stop policies
```

The kernel returns:

```json
{"stdout":"","stderr":"","exit_code":0}
```

All subprocess input uses filesystem IPC through
`tools/HME/event_kernel/fs_ipc.js`. Inputs are written under
`runtime/hme/event-ipc/<invocation>/stdin.json`, passed to the child as stdin
from that file, then cleaned up. This keeps the hook contract portable across
Claude Code, Codex, shell execution, and future agent CLIs.

Native handlers live in `tools/HME/event_kernel/native_hooks/`. Remaining shell
behavior stays behind the dispatcher or Stop-chain policy adapter until ported.

## Hook Portability Rules

- Do not add event routing tables to adapters.
- Do not add host-specific business logic to hooks.
- Add shared behavior to the event kernel, proxy middleware, policies, or
  worker modules.
- Use filesystem IPC at process boundaries.
- Prefer fail-loud behavior over silent fallback.
- Keep direct mode and proxy mode using the same dispatcher path.

## Command Surface

Keep `i/` commands for explicit actions:

- `i/hme admin action=selftest|health|reload|index|clear_index|warm`
- `i/review mode=forget|docs|health|convention`
- `i/learn query=...`
- `i/learn title=... content=... category=pattern`
- `i/trace target=<module> mode=impact`
- `i/status state`
- `i/status timeline window=30m`
- `i/status mode=hci-by-subtag`
- `i/why mode=block|state|verifier|hci-drop|kb-graph|predict|causality`
- `i/policies list|show|disable`

Do not expose wrappers for behavior that native tools already trigger
automatically.

## Working Loop

1. `i/status state` when orientation is unclear.
2. Edit through native tools; HME enriches context automatically.
3. `i/review mode=forget` after changes.
4. Run the project pipeline for behavioral changes.
5. Accept or write a KB entry with `i/learn`.
6. For HME substrate changes, run `i/hme admin action=selftest`.

The onboarding walkthrough in [templates/ONBOARDING.md](templates/ONBOARDING.md)
is the detailed first-session state machine.

## Enforcement Stack

- **Proxy middleware:** request/response transformations and native-tool
  replacement.
- **Event-kernel policies:** host-portable PreToolUse/PostToolUse/Stop routing.
- **Shell lifecycle stages:** lifecycle behavior not yet ported, still routed
  through the kernel.
- **HCI verifiers:** weighted self-coherence probes.
- **Declarative invariants:** `tools/HME/config/invariants.json`.
- **Pipeline validators:** source and metrics checks.
- **ESLint rules:** JavaScript architectural boundaries.

When a rule can be enforced mechanically, prefer enforcement over prose.

## LIFESAVER

LIFESAVER is the critical-error surface. It must remain intolerable until the
root cause is fixed.

Allowed calibration:

- maturity gates
- crash-vs-reconnect distinctions
- baseline-relative thresholds
- detector logic that becomes more accurate

Forbidden dampening:

- cooldowns
- deduplication
- "already alerted" sets
- time-based suppression
- severity downgrade for noise

If LIFESAVER is wrong, fix the detector. If it is right, fix the condition.
Do not make the alert quieter without changing whether the condition exists.

## Stop Detectors

Stop policies catch abandonment and malformed final behavior:

- `poll_count`
- `idle_after_bg`
- `psycho_stop`
- `ack_skip`
- `abandon_check`
- `stop_work`
- `fabrication_check`
- `early_stop`
- `exhaust_check`
- `scope_escape`
- `phantom_capability`
- `summary_format`
- `ceremony_dodge`
- `live_probe`
- `phase_gate`

Telemetry lands in `output/metrics/detector-stats.jsonl`.

## HCI And Holograph

`tools/HME/scripts/verify-coherence.py` scores the HME Coherence Index from
weighted verifiers across documentation, code, state, coverage, runtime,
topology, and interface contracts.

Useful commands:

```bash
python3 tools/HME/scripts/verify-coherence.py
python3 tools/HME/scripts/verify-coherence.py --json
python3 tools/HME/scripts/verify-coherence.py --score
python3 tools/HME/scripts/snapshot-holograph.py
```

The holograph snapshots HME state for later diffing: HCI, onboarding state,
tool surface, hook surface, KB summary, pipeline history, todo store, codebase
metrics, git state, and streak counters.

## RAG And Memory

HME indexing is tailored to Polychron's IIFE-heavy code:

- IIFE-aware chunking for global module assignments.
- symbol lookup and caller discovery for global-assignment modules.
- knowledge search over `tools/HME/KB/`.
- temporal decay so recent decisions remain prominent.
- typed KB relationships: `caused_by`, `fixed_by`, `depends_on`,
  `contradicts`, `similar_to`, `supersedes`.
- session narrative and think-history context for synthesis calls.

Context-budget awareness scales KB entries, callers, and model token budgets
from greedy to minimal based on remaining context.

## Local Inference

Local reasoning uses two llama.cpp servers behind the HME service:

- Arbiter: `hme-arbiter`, phi-4 LoRA, port 8080.
- Coder: `qwen3-coder:30b`, port 8081.

The reasoning cascade prefers the ranked API path when configured, then falls
back locally. The two local model aliases must remain distinct so fallback has
an independent route.

Operational checks:

```bash
systemctl status llamacpp-arbiter llamacpp-coder --no-pager
ss -tlnp
nvidia-smi --query-compute-apps=pid,process_name,used_gpu_memory --format=csv
```

If the RAG engine grows too large, restart the HME shim process and let the MCP
host relaunch it on the next tool call.

## Evolution Loop

HME supports the composition loop:

1. perceive from metrics and KB
2. diagnose through trace/review/search
3. evolve through edits
4. run pipeline
5. verify with review and metrics
6. persist KB learning
7. maintain index, docs, and selftests

The autonomous loop is hook-driven through `.claude/hme-evolver.local.md`. The
file is local/gitignored and lets Stop inject the next directive until a max
iteration count or done signal is reached.

## State Ownership Registry

This registry is parsed by `scripts/audit-state-file-ownership.py`. Update it
before adding a shared state writer.

### State files with single owner

| File | Owner | Read-only consumers |
|---|---|---|
| `runtime/hme/proxy-supervisor.pid` | `proxy-supervisor.sh` | shell ops, monitoring |
| `tmp/hme-proxy-maintenance.flag` | `proxy-maintenance.sh` | `proxy-supervisor.sh` |
| `tmp/hme-universal-pulse.heartbeat` | `universal_pulse.py` | `validate_startup.py` |
| `tmp/hme-non-hme-streak.score` | `_safety.sh` (`_streak_tick`) | `_safety.sh` (`_streak_check`) |
| `tmp/hme-streak-warn.txt` | `streak_calibrator.py` | `_safety.sh` |
| `tmp/hme-onboarding.state` | `_onboarding.sh` helpers | onboarding hook chain |
| `tmp/hme-log-errors.watermark` | `hme_log_watermark.js` | `hme_log_watermark.js` |
| `runtime/hme/supervisor-abandoned` | `proxy-supervisor.sh` | `userpromptsubmit.sh` |
| `output/metrics/detector-stats.jsonl` | each detector's `_emit_stats` | `audit-detector-stats.py` |
| `output/metrics/hme-predictions.jsonl` | `cascade_analysis._log_prediction` | reconciler |
| `output/metrics/hme-enricher-efficacy.jsonl` | `context_budget.js._recordFire` | reports |
| `output/metrics/hme-activity.jsonl` | `tools/HME/activity/emit.py` | `i/status`, reports |
| `tools/HME/before-editing-cache.json` | worker pre-edit cache writer | before-editing enrichment |
| `tools/HME/KB/*.lance` | worker KB indexer | knowledge search |

### State files with MULTIPLE writers

Multi-writer files require an explicit coordination strategy.

### `log/hme-errors.log`

**Writers:**

- `tools/HME/activity/universal_pulse.py`
- `tools/HME/proxy/middleware/20_hme_log_watermark.js`
- `tools/HME/proxy/middleware/19_mcp_fail_scan.js`
- `tools/HME/hooks/lifecycle/userpromptsubmit.sh`
- `tools/HME/hooks/helpers/_autocommit.sh`
- `tools/HME/hooks/helpers/safety/curl.sh`
- `tools/HME/hooks/helpers/safety/misc_safe.sh`
- `tools/HME/hooks/lifecycle/sessionstart.sh`
- `tools/HME/event_kernel/claude_adapter.js`
- `tools/HME/hooks/direct/autocommit-direct.sh`
- `tools/HME/hooks/direct/proxy-watchdog.sh`
- `tools/HME/hooks/pretooluse/pretooluse_check_pipeline.sh`
- `tools/HME/hooks/log-tool-call.sh`
- `tools/HME/hooks/helpers/_resolve_bg_stub.sh`
- `tools/HME/hooks/lifecycle/postcompact.sh`
- `tools/HME/hooks/lifecycle/precompact.sh`
- `tools/HME/hooks/lifecycle/stop/_preamble.sh`
- `tools/HME/hooks/lifecycle/stop/detectors.sh`
- `tools/HME/hooks/lifecycle/stop/holograph.sh`
- `tools/HME/hooks/pretooluse/pretooluse_grep.sh`
- `tools/HME/hooks/pretooluse/pretooluse_read.sh`
- `tools/HME/hooks/pretooluse/pretooluse_hme_primer.sh`
- `tools/HME/hooks/posttooluse/posttooluse_read_kb.sh`
- `tools/HME/hooks/pretooluse/bash/reader_guards.sh`
- `tools/HME/hooks/pretooluse/bash/cwd_rewrite.sh`
- `tools/HME/hooks/pretooluse/bash/blackbox_guards.sh`
- `tools/HME/telemetry/index.js`

**Coordination strategy:** append-only single-line writes with recognizable
source tags. New self-origin tags must be registered in the marker registry.

### `tmp/hme-nexus.state`

**Writers:**

- `tools/HME/proxy/middleware/index.js`
- `tools/HME/hooks/posttooluse/posttooluse_hme_review.sh`
- `tools/HME/hooks/lifecycle/stop/nexus_audit.sh`
- `tools/HME/hooks/lifecycle/userpromptsubmit.sh`
- `tools/HME/hooks/lifecycle/sessionstart.sh`

**Coordination strategy:** append-only writes plus bounded prune. Rewrites are
the risk surface; keep them rare and bounded.

### `tmp/hme-tab.txt`

**Writers:**

- `tools/HME/hooks/posttooluse/posttooluse_write.sh`
- `tools/HME/hooks/posttooluse/posttooluse_addknowledge.sh`
- `tools/HME/hooks/lifecycle/sessionstart.sh`
- posttooluse hooks calling `_append_file_to_tab`

**Coordination strategy:** append-only single-line writes with occasional
bounded cleanup.

### `tmp/hme-errors.turnstart` and `tmp/hme-errors.lastread`

**Writers:**

- `tools/HME/hooks/lifecycle/userpromptsubmit.sh`
- `tools/HME/hooks/lifecycle/stop/lifesaver.sh`

**Coordination strategy:** single actor per event class. Parallel sessions that
share `tmp/` would break this assumption.

## Testing
Useful HME checks:
```bash
node scripts/hme-hook-test.js
node tools/HME/hooks/direct_test.js
node --test tools/HME/tests/specs/pre_write_and_session_state.test.js
bash scripts/test/smoke-test-i-wrappers.sh
bash scripts/chaos/run-all.sh
```
Chaos tests live in `scripts/chaos/` and prove that selftest probes catch the
faults they were written to detect.
## Deep Links

- Event kernel: [../tools/HME/event_kernel/README.md](../tools/HME/event_kernel/README.md)
- Hooks: [../tools/HME/hooks/README.md](../tools/HME/hooks/README.md)
- Activity event schema: [../tools/HME/activity/EVENTS.md](../tools/HME/activity/EVENTS.md)
- Onboarding primer: [templates/ONBOARDING.md](templates/ONBOARDING.md)
- Composition reference: [src_full.md](src_full.md)

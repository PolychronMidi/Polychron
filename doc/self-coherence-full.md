# HME Full Reference

Detailed reference for [`tools/HME/`](../tools/HME/), distilled from the former per-topic docs.
Keep this as the single source of truth for HME architecture, lifecycle
behavior, state ownership, local inference, self-coherence, and operational
runbooks.

<!-- doc-infra-nav:start -->
## Navigation

- [Mental Model](#mental-model)
- [Surfaces](#surfaces)
- [Event Kernel](#event-kernel)
- [Hook Portability Rules](#hook-portability-rules)
- [Command Surface](#command-surface)
- [Working Loop](#working-loop)
- [Enforcement Stack](#enforcement-stack)
- [LIFESAVER](#lifesaver)
- [Stop Detectors](#stop-detectors)
- [HCI And Holograph](#hci-and-holograph)
- [RAG And Memory](#rag-and-memory)
- [Local Inference](#local-inference)
- [Evolution Loop](#evolution-loop)
- [State Ownership Registry](#state-ownership-registry)
- [Registries](#registries)
- [Testing](#testing)
- [Deep Links](#deep-links)
<!-- doc-infra-nav:end -->

## Mental Model

HME watches two coherences at once:

- **Musical coherence:** what the composition did, measured through pipeline
  metrics and fingerprint verdicts.
- **Self-coherence:** whether HME's own rules, docs, tools, state, and
  measurements still describe reality.

The agent acts through native tools and [`i/`](../i/) commands. The proxy, event kernel,
hooks, policies, worker, KB, and verifiers convert those actions into a
measured evolution loop.

## Surfaces

- [`i/`](../i/) wrappers: deliberate HME commands.
- Native Read/Edit/Grep/Glob/TodoWrite: enriched or replaced by proxy
  middleware where appropriate.
- Codex fallback bridge: when a host lacks native Read/Edit, adapter-owned
  internals may synthesize native events; this is not a public [`i/`](../i/) surface.
- Codex `update_plan`: synced into the same TODO store by `codex_proxy` while
  Responses events stream; universal pulse remains the fallback session-log
  scanner. There is no normal manual sync command; sync failures are repaired
  in proxy/pulse plumbing.
- Proxy middleware: transforms inference and native-tool results.
- Event kernel: portable routing for lifecycle and tool events.
- Hooks: host-specific adapters and remaining shell lifecycle stages.
- Worker service: KB, review, learn, trace, status, policies, admin actions.
- Metrics: JSON/JSONL state in `output/metrics/`, `tmp/`, [`tools/HME/runtime/`](../tools/HME/runtime/), and
  `log/`.

## Event Kernel

[`tools/HME/event_kernel/dispatcher.js`](../tools/HME/event_kernel/dispatcher.js) is the canonical event router. Adapters
handle transport only.

```text
Claude Code event
  -> event_kernel/claude_adapter.js
     -> proxy /hme/lifecycle when proxy is up
     -> dispatcher directly when proxy is down
  -> event_kernel/dispatcher.js
     -> native JS handlers, shell stages, or Stop policies
```

```text
Codex event
  -> event_kernel/codex_adapter.js
     -> proxy /hme/lifecycle when proxy is up
     -> dispatcher directly when proxy is down
  -> event_kernel/dispatcher.js
     -> native JS handlers, shell stages, PermissionRequest policy, or Stop policies
```

Codex inference traffic can also route through the peer Responses proxy:

```text
Codex CLI
  -> http://127.0.0.1:<codex_proxy>/v1/responses
  -> tools/HME/proxy/codex_proxy.js
     -> observes prompt/tool shape
     -> applies config-driven request transforms from codex-proxy.json
     -> syncs streamed update_plan calls into TODO.md
     -> forwards the native Responses stream upstream
```

The kernel returns:

```json
{"stdout":"","stderr":"","exit_code":0}
```

All subprocess input uses filesystem IPC through
[`tools/HME/event_kernel/fs_ipc.js`](../tools/HME/event_kernel/fs_ipc.js). Inputs are written under
`tools/HME/runtime/event-ipc/<invocation>/stdin.json`, passed to the child as stdin
from that file, then cleaned up. This keeps the hook contract portable across
Claude Code, Codex, shell execution, and future agent CLIs.

Native handlers live in [`tools/HME/event_kernel/native_hooks/`](../tools/HME/event_kernel/native_hooks/). Remaining shell
behavior stays behind the dispatcher or Stop-chain policy adapter until ported.

Claude Code hook registration is manifest-driven. Edit
[`tools/HME/hooks/hooks.json`](../tools/HME/hooks/hooks.json), then run [`tools/HME/scripts/sync-claude-settings.py`](../tools/HME/scripts/sync-claude-settings.py) to
materialize live `~/.claude/settings.json`; [`tools/HME/scripts/audit-claude-settings.py`](../tools/HME/scripts/audit-claude-settings.py)
fails if live settings drift from that manifest.

Codex hook and provider registration is manifest-driven as well. Edit
[`tools/HME/hooks/codex_hooks.json`](../tools/HME/hooks/codex_hooks.json), then run [`tools/HME/scripts/sync-codex-settings.py`](../tools/HME/scripts/sync-codex-settings.py)
to materialize `~/.codex/hooks.json`, enable `features.hooks`, and route the
Responses provider through the `codex_proxy` service-registry port.
[`tools/HME/scripts/audit-codex-settings.py`](../tools/HME/scripts/audit-codex-settings.py) checks for drift. Codex requires review for
non-managed user hooks, so `/hooks` may need a one-time trust action before the
Codex hook adapter runs; the provider proxy still intercepts non-interactive
Codex traffic without that trust step.

The same sync script owns Codex's model-catalog replacement. It reads
`~/.codex/models_cache.json`, writes the generated
`tools/HME/runtime/codex-model-catalog.json`, and sets these root config keys:

```toml
model_catalog_json = "/home/jah/Polychron/tools/HME/runtime/codex-model-catalog.json"
model_context_window = 1050000
```

The generated catalog keeps Codex's current model list and capability metadata
but replaces model prompt text with HME sources:

- `base_instructions` -> [`doc/templates/canonical-system-prompt.md`](templates/canonical-system-prompt.md)
- `model_messages.instructions_template` -> [`doc/templates/canonical-system-prompt.md`](templates/canonical-system-prompt.md)
- `model_messages.instructions_variables.personality_pragmatic` -> [`AGENTS.md`](templates/AGENTS.md)
- `context_window` and `max_context_window` -> `1050000`

`~/.codex/models_cache.json` stays Codex-owned generated state; HME never edits
it directly.

## Hook Portability Rules

- Do not add event routing tables to adapters.
- Do not add host-specific business logic to hooks.
- Add shared behavior to the event kernel, proxy middleware, policies, or
  worker modules.
- Use filesystem IPC at process boundaries.
- Prefer fail-loud behavior over silent fallback.
- Keep direct mode and proxy mode using the same dispatcher path.

## Command Surface

Keep [`i/`](../i/) commands for explicit actions:

- `i/hme admin action=selftest|health|reload|index|clear_index|warm|todo_status|todo_validate|todo_repair|todo_archive`
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
5. Accept or write a KB entry with [`i/learn`](../i/learn).
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
- **Declarative invariants:** [`tools/HME/config/invariants.json`](../tools/HME/config/invariants.json) indexes domain shards in `tools/HME/config/invariants/`.
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
- `phase_gate`

Telemetry lands in `output/metrics/detector-stats.jsonl`.

## HCI And Holograph

[`tools/HME/scripts/verify-coherence.py`](../tools/HME/scripts/verify-coherence.py) scores the HME Coherence Index from
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
- knowledge search over [`tools/HME/KB/`](../tools/HME/KB/).
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

If the RAG engine grows too large, restart the HME proxy bundle; the proxy
supervises the worker and relaunches it from the service registry.

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

The registry lives in [`tools/HME/config/state-files.json`](../tools/HME/config/state-files.json) and is parsed by
[`tools/HME/scripts/audit-state-file-ownership.py`](../tools/HME/scripts/audit-state-file-ownership.py). Each entry declares path, owner,
readers, writers, retention, generated/committed status, schema, and repair
command. Update that JSON before adding a shared state writer.

<!-- BEGIN GENERATED STATE REGISTRY -->
- Registered state paths: 31 (24 single-owner, 7 multi-writer).
- Generated state: 31; committed state: 3.
- Repair commands and reader/writer ownership live in [`tools/HME/config/state-files.json`](../tools/HME/config/state-files.json).
- Multi-writer paths:
  - [`doc/templates/TODO.md`](templates/TODO.md) -- 5 writer(s): tools/HME/service/server/tools_analysis/todo_md_sync.py, tools/HME/service/server/tools_analysis/todo_archive.py, tools/HME/scripts/todo_autoflip.py (+2 more)
  - `log/hme-errors.log` -- 28 writer(s): tools/HME/activity/universal_pulse.py, tools/HME/proxy/middleware/20_hme_log_watermark.js, tools/HME/proxy/middleware/19_mcp_fail_scan.js (+25 more)
  - `tmp/hme-errors.lastread` -- 2 writer(s): tools/HME/hooks/lifecycle/userpromptsubmit.sh, tools/HME/hooks/lifecycle/stop/lifesaver.sh
  - `tmp/hme-errors.turnstart` -- 1 writer(s): tools/HME/hooks/lifecycle/userpromptsubmit.sh
  - `tmp/hme-nexus.state` -- 5 writer(s): tools/HME/proxy/middleware/index.js, tools/HME/hooks/posttooluse/posttooluse_hme_review.sh, tools/HME/hooks/lifecycle/stop/nexus_audit.sh (+2 more)
  - `tmp/hme-tab.txt` -- 4 writer(s): tools/HME/hooks/posttooluse/posttooluse_write.sh, tools/HME/hooks/posttooluse/posttooluse_addknowledge.sh, tools/HME/hooks/lifecycle/sessionstart.sh (+1 more)
  - [`tools/HME/KB/todos.json`](../tools/HME/KB/todos.json) -- 2 writer(s): tools/HME/service/server/tools_analysis/todo_store.py, tools/HME/scripts/codex_plan_sync.py
<!-- END GENERATED STATE REGISTRY -->

The standard coordination patterns are append-only line writes, atomic rename
for replacements, and narrow bounded rewrites where unavoidable. New state
without a declared owner is a coherence failure.

## Registries

- Services: [`tools/HME/config/services.json`](../tools/HME/config/services.json); Python, JS, and shell helpers
  derive ports, health URLs, supervision edges, PID labels, process patterns,
  logs, and starts from it.
- [`i/`](../i/) surface: [`tools/HME/i_registry.json`](../tools/HME/i_registry.json); [`tools/HME/scripts/generate-i-shims.js`](../tools/HME/scripts/generate-i-shims.js)
  generates/checks the public shims, and [`tools/HME/scripts/hme-i-dispatch.js`](../tools/HME/scripts/hme-i-dispatch.js) owns
  behavior.
- Agent jobs: `tools/HME/runtime/agent-jobs/<role>/<job_id>/` contains
  `request.json`, `status.json`, `output.txt`, `stderr.txt`, and
  `events.jsonl`.
- Adapter boundaries: [`tools/HME/config/adapter-boundaries.json`](../tools/HME/config/adapter-boundaries.json); bridge/shim/wrapper
  filenames are allowed only for real adapters, generators, or domain terms.

## Testing
Useful HME checks:
```bash
node tools/HME/scripts/hme-hook-test.js
node tools/HME/hooks/direct_test.js
node --test tools/HME/tests/specs/pre_write_and_session_state.test.js
bash tools/HME/tests/scripts/smoke-test-i-wrappers.sh
bash tools/HME/scripts/chaos/run-all.sh
```
Chaos tests live in [`tools/HME/scripts/chaos/`](../tools/HME/scripts/chaos/) and prove that selftest probes catch the
faults they were written to detect.
## Deep Links

- Event kernel: [../tools/HME/event_kernel/README.md](../tools/HME/event_kernel/README.md)
- Hooks: [../tools/HME/hooks/README.md](../tools/HME/hooks/README.md)
- Activity event schema: [../tools/HME/activity/EVENTS.md](../tools/HME/activity/EVENTS.md)
- Onboarding primer: [templates/ONBOARDING.md](templates/ONBOARDING.md)
- Composition reference: [composition-full.md](composition-full.md)

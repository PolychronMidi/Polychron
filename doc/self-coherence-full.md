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

The agent acts through native tools and [`i/`](../tools/HME/i/) commands. The proxy, event kernel,
hooks, policies, worker, KB, and verifiers convert those actions into a
measured evolution loop.

## Surfaces

- [`i/`](../tools/HME/i/) wrappers: deliberate HME commands.
- Native Read/Edit/Grep/Glob/TodoWrite: enriched or replaced by proxy
  middleware where appropriate.
- Codex fallback bridge: when a host lacks native Read/Edit, adapter-owned
  internals may synthesize native events; this is not a public [`i/`](../tools/HME/i/) surface.
- Todos: `doc/templates/TODO.md` is the single source of truth -- a status-code
  line grammar the agent edits directly; `tools/HME/todo_engine` applies timed
  status flips and archives fully-resolved sets to `log/todo/`.
- Proxy middleware: transforms inference and native-tool results.
- Event kernel: portable routing for lifecycle and tool events.
- Hooks: host-specific adapters and remaining shell lifecycle stages.
- Worker service: KB, review, learn, trace, status, policies, admin actions.
- Metrics: JSON/JSONL state in `src/output/metrics/`, `tmp/`, [`tools/HME/runtime/`](../tools/HME/runtime/), and
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
[`tools/HME/hooks/codex_hooks.json`](../tools/HME/hooks/codex-extensions.json), then run [`tools/HME/scripts/sync-codex-settings.py`](../tools/HME/scripts/sync-codex-settings.py)
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
model_catalog_json = "tools/HME/runtime/codex-model-catalog.json"
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

Keep [`i/`](../tools/HME/i/) commands for explicit actions:

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
5. Accept or write a KB entry with [`i/learn`](../tools/HME/i/learn).
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

Telemetry lands in `src/output/metrics/detector-stats.jsonl`.

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
- Registered state paths: 32 (24 single-owner, 8 multi-writer).
- Generated state: 31; committed state: 1.
- Repair commands and reader/writer ownership live in `tools/HME/config/state-files.json`.
- Multi-writer paths:
  - `doc/templates/TODO.md` -- 2 writer(s): tools/HME/todo_engine/store.py, tools/HME/todo_engine/lifesaver_bridge.py
  - `log/hme-errors.log` -- 27 writer(s): tools/HME/activity/universal_pulse.py, tools/HME/proxy/middleware/20_hme_log_watermark.js, tools/HME/proxy/middleware/19_mcp_fail_scan.js (+24 more)
  - `tmp/hme-nexus.state` -- 5 writer(s): tools/HME/proxy/middleware/index.js, tools/HME/hooks/posttooluse/posttooluse_hme_review.sh, tools/HME/hooks/lifecycle/stop/nexus_audit.sh (+2 more)
  - `tmp/hme-tab.txt` -- 4 writer(s): tools/HME/hooks/posttooluse/posttooluse_write.sh, tools/HME/hooks/posttooluse/posttooluse_addknowledge.sh, tools/HME/hooks/lifecycle/sessionstart.sh (+1 more)
  - `tools/HME/runtime/errors-lastread` -- 2 writer(s): tools/HME/hooks/lifecycle/userpromptsubmit.sh, tools/HME/hooks/lifecycle/stop/lifesaver.sh
  - `tools/HME/runtime/errors-turnstart` -- 1 writer(s): tools/HME/hooks/lifecycle/userpromptsubmit.sh
  - `tools/HME/runtime/metrics/*` -- 3 writer(s): tools/HME/proxy/infra/hme_paths.js, tools/HME/scripts/hme_paths.py, HME components using HME_METRICS_DIR
  - `tools/HME/runtime/state/*` -- 3 writer(s): tools/HME/proxy/infra/hme_paths.js, tools/HME/scripts/hme_paths.py, HME components using HME_STATE_DIR
<!-- END GENERATED STATE REGISTRY -->

The standard coordination patterns are append-only line writes, atomic rename
for replacements, and narrow bounded rewrites where unavoidable. New state
without a declared owner is a coherence failure.

## Registries

- Services: [`tools/HME/config/services.json`](../tools/HME/config/services.json); Python, JS, and shell helpers
  derive ports, health URLs, supervision edges, PID labels, process patterns,
  logs, and starts from it.
- [`i/`](../tools/HME/i/) surface: [`tools/HME/i_registry.json`](../tools/HME/i_registry.json); [`tools/HME/scripts/generate-i-shims.js`](../tools/HME/scripts/generate-i-shims.js)
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
- Activity event schema: see the [HME Telemetry Events](#hme-telemetry-events) section above
- Onboarding primer: [templates/ONBOARDING.md](templates/ONBOARDING.md)
- Composition reference: [composition-full.md](composition-full.md)

# HME proxy bounded contexts

The proxy is large (107 files / ~14.5K lines). To keep coupling
manageable while a full physical reorganization happens incrementally,
this document declares the **bounded contexts** every new or migrated
file should belong to. A file lives in exactly one context;
cross-context dependencies should go through a single façade per
context, never reach into another context's internals.

## Contexts

### request_mutation

Transforms the inbound client request before dispatch.

- `hme_proxy_request_mutation.js`, `messages.js`, `context.js`,
  `compactor*.js`, `prompt_spam_guard.js`, all `middleware/*` modules.
- Façade: `hme_proxy_request_mutation.mutateClaudeRequest`.

### upstream_dispatch

Resolves upstream + sends the request. Owns OmniRoute selection,
overdrive routing, and the http(s) transport layer.

- `upstream.js`, `overdrive_route.js`, `omniroute_client.js`,
  `omniroute_protocol.js`, `model_route_resolver.js`,
  `model_route_health.js`, `swap_state_store.js`, `hme_proxy_headers.js`,
  `service_registry.js`, `hme_proxy.js`.
- Façade: `hme_proxy_claude.handleRequest` (the Anthropic entrypoint).

### response_transform

Buffers and rewrites the upstream response into Anthropic-compatible
SSE/JSON.

- `hme_proxy_anthropic_response.js`, `legacy_swap_response.js`,
  `sse_slop_rewriter.js`, `sse_stop_hook_rewriters.js`,
  `codex_response_forwarder.js`, `codex_tool_text.js`,
  `codex_omniroute.js`, `zen_translator.js`, `reasoning_to_thinking.js`,
  `hme_proxy_response_send.js`, `hme_proxy_response_trace.js`,
  `omni_tool_loop.js`.
- Façade: `hme_proxy_anthropic_response.handleAnthropicResponseComplete`.

### failure_policy

Classifies failures, decides retry/fallback action, persists route
quarantines, refreshes OAuth tokens. Pure functions where possible.

- `omni_failure_policy.js` (the policy table),
  `hme_proxy_upstream_failure.js`, `hme_proxy_codex.js`,
  `hme_proxy_connection_errors.js`, `failure_classification.js`,
  `model_route_health.js` (cooldowns).
- Façade: `hme_proxy_upstream_failure.handleUpstreamFailureOrSuccess`.

### lifecycle_bridge

Maps Claude Code lifecycle events (PreToolUse, PostToolUse,
SessionStart, Stop, UserPromptSubmit) into the portable event kernel.

- `lifecycle_bridge.js`, `hme_proxy_routes.js`, `start_marker.js`,
  `hme_dispatcher.js`, `supervisor/*.js`.
- Façade: `lifecycle_bridge.handleLifecycleRoute`.

### infra (shared primitives)

Below all the contexts; should not depend on any of them.

- `hme_config.js`, `subprocess.js`, `lifecycle_state.js`, `hme_paths.js`,
  `shared/*.js`, `_dump.js`, `proxy_route_metrics.js`,
  `config_loader.js`.

## Rules

1. **One façade per context.** Cross-context calls go through the
   declared façade module. Reaching into a different context's helper
   file is a refactor smell.
2. **Pure helpers stay in infra.** Anything that doesn't depend on
   another context belongs in infra so all contexts can use it without
   pulling in a sibling context.
3. **State lives in `lifecycle_state.js`.** Direct `fs.readFileSync` of
   runtime markers is forbidden in new code.
4. **Shell-outs go through `subprocess.js`.** Direct `child_process`
   imports outside `subprocess.js` are deprecated.
5. **Env reads go through `hme_config.js`.** Direct `_hmeRequireEnv`
   calls in new code are deprecated.

These rules are advisory until a verifier enforces them; for now they
exist so new code and incremental migrations have a clear target.

## Adopt-incrementally migration order

Smallest-blast-radius first; each step is a separate commit:

1. Infra helpers in place: `hme_config.js`, `subprocess.js`,
   `lifecycle_state.js`, `omni_failure_policy.js`.
2. Migrate one shell-out call site at a time to `subprocess.runSync`.
3. Migrate one state-file read at a time to `lifecycle_state`.
4. Migrate one env read at a time to `hme_config.load()`.
5. After enough leaves move, lift the façades into per-context
   directories (`proxy/contexts/<name>/index.js`).

# Hook auto-rewrites and blocks

PreToolUse and PostToolUse hooks run policies from
`tools/HME/policies/builtin/`. Policies fall into three kinds:

- **block-*** — deny the tool call when the pattern fires.
- **rewrite-*** — mutate the tool input/output in place so the call can
  proceed without a model retry. Surfaced as `DDoC stripped:` system
  reminders.
- **nexus-*** — informational checks gated by the unified TODO/NEXUS
  surface.

This document inventories every policy currently registered so the
model has a single place to look up "why did my edit lose a line / get
rewritten / get blocked?".

## rewrite policies (silent mutation)

| Policy                          | Trigger                                                | Mutation                                                                  |
|  |  |  |
| `rewrite-console-warn-prefix`   | `console.warn('...')` without the `Acceptable warning: ` prefix | Prepend the prefix to the first string argument.                  |
| `rewrite-except-pass-silent-ok` | Python `except ...: pass` with no annotation           | Append `# silent-ok: pending review` to the pass line.                    |
| `rewrite-hardcoded-project-root`| Hardcoded project-root literal in Write/Edit content   | Replace with `$PROJECT_ROOT`.                                             |
| `block-character-spam`          | 4+ identical decoration chars (`====`, `####`, etc.)   | Strip the offending runs in-place. Per-line opt-out via `spam-ok` token.  |
| `block-comment-bloat`           | 3+ consecutive non-annotation comment lines            | Truncate long comment lines and remove bloat lines.                       |
| `block-comment-ellipsis-stub`   | Comment-ellipsis stub placeholders (`// ... rest`)     | Strip the stub.                                                           |

The "block-" prefix on the last three is historical; they currently
rewrite rather than block. New rewrite-class policies should use the
`rewrite-` prefix.

## block policies (deny)

| Policy                          | Trigger                                                                              |
|  |  |
| `block-curl-pipe-sh`            | `curl ... \| sh` / `wget ... \| bash` and variants (supply-chain attack pattern).    |
| `block-git-checkout-clobber`    | Broad `git checkout <ref> -- .` clobbers and direct restore of unified TODO state.   |
| `block-memory-dir-writes`       | Writes to `.claude/projects/.../memory/`.                                            |
| `block-mid-pipeline-write`      | Writes/edits to `src/` while `tmp/run.lock` exists.                                  |
| `block-misplaced-log-tmp`       | Writes to nested `log/` or `tmp/` subdirectories (must live at project root).        |
| `block-misplaced-metrics`       | Writes to `metrics/` outside `src/output/metrics/`.                                  |
| `block-mkdir-misplaced-log-tmp` | `mkdir` of nested `log/` or `tmp/` directories.                                      |
| `block-mkdir-misplaced-metrics` | `mkdir` of `metrics/` outside `src/output/metrics/`.                                 |
| `block-runlock-deletion`        | Deletion of `tmp/run.lock`.                                                          |
| `block-secret-content-pattern`  | Write/Edit content matching known secret patterns.                                   |
| `block-secrets-write`           | Writes to canonical secret file paths (`.env`, `.credentials.json`, etc.).           |

## nexus policies

| Policy                          | Trigger                                                                              |
|  |  |
| `nexus-edit-check`              | Edits to files referenced by an open NEXUS TODO entry.                               |
| `no-conflicts`                  | Edits to files currently flagged in merge-conflict state.                            |
| `auto-fill-agent-description`   | Spawning a sub-agent without a `description` argument.                               |

## Surface messages

When a rewrite policy fires, the model receives a `system-reminder`
containing `DDoC stripped: <rule_name> <details>`. To attribute a strip
back to the responsible policy, search the policy directory for the rule
name printed in the message.

## Lint-only mode (proposed)

Setting `HME_POLICIES_LINT_ONLY=1` would route all rewrites to warnings
(no mutation) for a development window. This is not implemented yet but
is the cleanest path to making policy churn visible during refactors
without disabling the policies entirely.

# HME OpenCode Universal Hook ABI

HME owns `hme-opencode-hook/v1` as the canonical bridge contract between native hooks, proxy surfaces, OMO, and OpenCode-compatible plugins.

## Boundary

The ABI is an internal HME contract. OpenCode compatibility shapes the phase names and plugin-facing concepts, but HME keeps final authority over lifecycle, stop-chain, tool safety, and stream rewriting.

## Core phases

These phases mirror OpenCode-compatible hook concepts:

- `chat.params` -- request/chat parameter observation or mutation.
- `permission.ask` -- permission mediation before risky actions.
- `tool.execute.before` -- pre-tool execution policy checks.
- `tool.execute.after` -- post-tool observation and validation.

## HME extension phases

These phases are mandatory HME extensions, not optional plugin conveniences:

- `stop.before` -- stop-chain and lifecycle completion enforcement.
- `stream.text_block` -- buffered stream text-block allow/drop/rewrite decisions.

They are explicit because existing HME semantics are stricter than generic OpenCode hooks. External plugins may participate only through declared capabilities; they cannot override mandatory HME denials.

## Observational phases

The contract also reserves low-risk observation phases for migration and shadow parity:

- `session.start`
- `session.end`
- `message.input`
- `message.output`
- `stream.delta`
- `policy.evaluate`
- `telemetry.event`

## Decision kinds

Universal hook decisions are normalized before host-specific translation:

- `allow`
- `deny`
- `modify`
- `rewrite`
- `drop`
- `inject`
- `ask_permission`
- `defer`

Provider adapters translate these decisions into Claude, Codex, Anthropic, OpenAI, OpenCode, or proxy-specific behavior. Unsupported host decisions must be explicit, never silent.

## Current scope

This phase adds the ABI contract, validators, OpenCode shadow-mode routing, and
env-gated live application for the small set of decisions HME can safely express
as HME-owned hook responses.

Implemented surfaces:

- `tools/HME/omo_bridge/contract.json`
- `tools/HME/omo_bridge/contract_validator.js`
- `tools/HME/omo_bridge/universal_event.js`
- `tools/HME/omo_bridge/universal_decision.js`
- `tools/HME/omo_bridge/shadow_runtime.js`
- `tools/HME/event_kernel/dispatcher.js`
- `tools/HME/tests/specs/omo_contract.test.js`

Shadowed dispatcher events:

- `SessionStart` -> `session.start`
- `Stop` -> `stop.before`
- `PreToolUse` -> `tool.execute.before`
- `PermissionRequest` -> `permission.ask`
- `PostToolUse` -> `tool.execute.after`

Enable shadow mode with `HME_OMO_ENABLED=1` and `HME_OMO_MODE=shadow`. Configure
the OMO source using `HME_OMO_SOURCE=path` plus `HME_OMO_PATH`, or
`HME_OMO_SOURCE=package` plus `HME_OMO_PACKAGE`. Optional controls are
`HME_OMO_REQUIRED_VERSION`, `HME_OMO_TIMEOUT_MS`, `HME_OMO_PHASES`, and
`HME_OMO_PRELOAD`. Per-phase timeout variables use the phase name uppercased
with dots replaced by underscores, for example
`HME_OMO_TIMEOUT_TOOL_EXECUTE_BEFORE_MS`. `HME_OMO_TOOL_BEFORE_WARM_ONLY=1`
skips cold `tool.execute.before` shadow observation until SessionStart preload
has initialized OMO.

In this workspace the installed package path is the current real-entrypoint
smoke target: `HME_OMO_SOURCE=package` and
`HME_OMO_PACKAGE=oh-my-openagent`. The development checkout at
`tools/oh-my-openagent` may not have `dist/index.js` until it is built. Use a
larger timeout, for example `HME_OMO_TIMEOUT_MS=10000`, when measuring cold
`tool.execute.before` startup.

HME remains authoritative. Shadow decisions, mutations, denials, plugin load
errors, invalid events, and timeouts are telemetry only and cannot change live
allow/deny, stop-chain, stream rewriting, permissions, provider routing,
secret/path policy, or capability filtering.

Enable live mode with `HME_OMO_ENABLED=1` and `HME_OMO_MODE=live`. Live mode uses
the same source and timeout controls but only applies supported decisions after
normalization and capability validation:

- `PreToolUse` / `tool.execute.before`: `deny`, or `modify` with target `tool.input`.
- `PermissionRequest` / `permission.ask`: `deny`.
- `Stop` / `stop.before`: `deny`, and only when the HME stop-chain did not already block.

OMO live failures are fail-open: missing builds, dependency/version failures,
invalid events, plugin errors, timeouts, and unsupported decisions fall through
to HME's native hook chain. Modified tool input is fed through downstream HME
write/policy/native-hook validation before the modification is returned to the
host. OMO does not bypass HME stop-chain, provider routing, stream rewriting,
permission policy, secret/path policy, or capability filtering.

Operational shadow telemetry is compact by design. HME writes phase, status,
decision kind, plugin result statuses, duration, and hashes to
`omo-shadow-decisions.jsonl` in the HME runtime directory. It does not write raw
messages, prompts, tool arguments, command strings, patches, or reasons. Use
`node tools/HME/scripts/omo-shadow-status.js` for recent status, decision, and
latency summaries. Add `--fail-on-unhealthy` with thresholds such as
`--max-timeout-rate` and `--max-p95-ms` to use the same data as a rollout gate.

Future expansion of live application must remain separately enabled,
phase-scoped, and tested against safety boundaries. External OMO output may not
override HME denials or mutate safety-critical surfaces unless HME explicitly
converts that observation into an HME-owned decision after policy validation.

# Universal Hook Provider Template

A new host must add adapter edges; policy code must not change.

## Required checklist

1. Event extraction: convert native lifecycle/tool/stream payloads into `hme-opencode-hook/v1` events.
2. Session identity: preserve session id, cwd/project root, provider, model, and agent when available.
3. Tool/permission representation: map tool name, input, output, permission target, and risk into canonical fields.
4. Decision application path: translate universal decisions back to host outputs without silent degradation.
5. Capability map entry: classify every ABI phase as `unsupported`, `advisory`, or `enforcement`.
6. Golden fixtures: add inbound and outbound fixtures before enabling live routing.
7. Shadow parity: run comparator telemetry before live enforcement.
8. Cleanup gate: remove old host-specific policy only after parity and focused suites pass.

## Capability meanings

- `unsupported`: host cannot apply this phase/decision; safety-critical unsupported decisions fail closed.
- `advisory`: host can observe and emit telemetry/effects, but cannot enforce live behavior.
- `enforcement`: host can apply allow/deny/mutate/rewrite decisions through a translator.

## Minimal files

```text
tools/HME/omo_bridge/adapters/<host>_inbound.js
tools/HME/omo_bridge/translators/<host>_decision.js
tools/HME/tests/fixtures/universal_hooks/<host>.json
tools/HME/tests/specs/universal_hook_<host>.test.js
```

# Codex streaming tool-loop contract

Interactive Codex requests (`stream: true`) must stay coherent between the CLI, HME proxy logs, and OmniRoute logs.

## Contract

When HME executes a Codex tool loop server-side for a streamed request:

1. HME must open a client-visible SSE stream before or during the first server-side tool execution.
2. HME must emit at least one client-visible progress delta before the final assistant answer.
3. Visible progress may include the safe tool label and bounded result metadata, but must not stream full tool output by default.
4. HME must not forward executable duplicate tool-call events to the client while also executing the same tool server-side.
5. HME must not leak raw unsupported Claude-style tool calls such as `Bash`, `Read`, or `Agent` as client-executable calls.
6. HME must not return `508 Loop Detected` for bounded tool loops; it must finalize or return a safe bounded fallback.
7. HME must not ask the user to resend task context solely because of stale/incomplete/unsupported tool adapter noise.

## Correlation

Every Codex turn forwarded by HME should share these trace fields across response metrics and upstream request headers:

- `correlation_id`
- `session_id`
- `thread_id`
- `turn_id`
- `tool_loop_depth`
- `call_ids`
- upstream/final response id when available

HME sends equivalent upstream headers where possible:

- `x-hme-codex-correlation-id`
- `x-hme-codex-session-id`
- `x-hme-codex-thread-id`
- `x-hme-codex-turn-id`
- `x-hme-codex-tool-loop-depth`

## Hidden-loop violation

A hidden-loop violation is any streamed Codex turn where HME executes one or more server-side tool calls but records zero client-visible progress events.

Such cases are logged as:

```text
codex-hidden-tool-loop-violation
```

A healthy streamed server-side loop logs:

```text
codex-proxy-tool-loop-visible
```

and the final `response` event includes:

- `client_sse_started: true`
- `client_visible_progress_events > 0`
- `tool_loop_count > 0`

# Codex tool-loop graph

HME's Codex tool loop is represented as an explicit small graph instead of unbounded recursive proxy branches.

This is LangGraph-style orchestration implemented in-process for the current CommonJS proxy. The graph shape is intentionally small so it can later be swapped to LangGraphJS `StateGraph` without changing the proxy contract.

## State

The graph state records:

- `correlation_id`, `session_id`, `thread_id`, `turn_id`
- route and response kind (`json` / `sse`)
- current `tool_loop_depth` (observability only — no cap is imposed)
- collected tool calls
- actionable tool calls
- skipped malformed tool calls
- duplicate call IDs
- approval-gated calls
- selected decision and invariant

## Nodes

```text
inspect_response
  -> execute_tools
  -> malformed_tool_fallback
  -> duplicate_tool_fallback
  -> interrupt_before_tool
  -> final
```

The proxy only executes tools after the graph returns `execute_tools`. There is no depth limit and no "finalization" stage; the tool loop runs as long as the upstream model keeps requesting tools, the same way the Anthropic/Claude route does. Context pressure is handled exclusively by the shared `passthrough_compact` path at the configured high-water fraction.

## Invariants

The graph encodes invariants directly rather than relying on detector sprawl:

- `visible_progress_required`: streamed server-side tool execution must emit client-visible progress.
- `no_duplicate_tool_execution`: a call ID already executed in the turn cannot execute again.
- `no_raw_tool_leakage`: malformed tool calls are converted into a fallback path, not raw client tool calls.
- `human_approval_gate`: destructive or write-capable tools can interrupt before execution when HITL is enabled.

## Checkpoints

Each graph transition writes best-effort durable checkpoints to:

```text
tools/HME/runtime/codex-tool-loop-checkpoints.jsonl
tools/HME/runtime/codex-tool-loop-checkpoints/<correlation_id>.json
```

Checkpoints are compact observability records, not full prompt/history dumps. They contain routing state, call summaries, decision, invariant, and trace IDs.

## Human approval

Set:

```text
HME_CODEX_HITL=1
```

to make the graph return `interrupt_before_tool` before:

- `Edit`
- `Write`
- destructive `Bash` commands such as `rm`, `git reset --hard`, `git clean`, force push, recursive chmod/chown, etc.

Current proxy behavior for an interrupt is a bounded final response with the checkpoint ID. A future UI/Studio bridge can resume from the checkpoint after approval.

## LangGraphJS migration seam

The current module is:

```text
tools/HME/proxy/codex_tool_loop_graph.js
```

It exposes a pure decision function:

```js
runCodexToolLoopGraph({ target, source, parsed, calls, executed_call_ids, response_kind })
```

This seam mirrors a future LangGraphJS `StateGraph`: state in, node transitions, checkpoint writes, decision out.

# smolagents HME tool registry

HME's canonical custom tools now live as smolagents `Tool` subclasses.

The agent-facing names intentionally stay bare/native-looking:

```text
Agent
Bash
Edit
Read
WebFetch
WebSearch
Write
```

Do not prefix these names with `hme_`. The proxy, graph, and model schemas should preserve the same names so tools are indistinguishable from native tools from the agent perspective.

## Source of truth

```text
tools/HME/hme_tools/base.py
tools/HME/hme_tools/tools.py
```

`HMETool` subclasses `smolagents.Tool` and adds HME metadata:

- `side_effect`
- `approval`
- `idempotent`
- `max_output_bytes`
- `aliases`
- `visibility`
- `policy`

The smolagents fields remain the canonical model-facing contract:

- `name`
- `description`
- `inputs`
- `output_type`
- `output_schema`
- `forward()`

## Export surfaces

Use:

```bash
python3 tools/HME/hme_tools/export.py --kind codex
python3 tools/HME/hme_tools/export.py --kind hme
```

`codex`/`openai`/`claude` exports model tool schemas with bare names.

`hme` exports the same schemas plus HME policy metadata.

The Node proxy consumes these through:

```text
tools/HME/proxy/hme_tool_registry.js
tools/HME/proxy/codex_uniform_tools.js
```

## Execution

Use:

```bash
python3 tools/HME/hme_tools/run_tool.py Bash --json <<< '{"command":"printf ok"}'
```

`run_tool.py` executes by bare tool name. Existing JS structured tool behavior remains the execution backend for Read/Edit/Write/WebFetch/Agent while the canonical declaration moves to smolagents.

## Test contract

```bash
node --test tools/HME/tests/specs/smolagents_tool_registry.test.js
```

The tests assert:

- exact bare tool names
- no `hme_` prefixes
- exported schemas are function/object schemas
- HME policy metadata is separate from model schema
- bare-name tool execution works

# HME Dominance Layer -- design intent

The agent never notices the tools. They've already run.

## What's explicitly NOT in scope

- **Memory system**: deprecated in this project. Persistence = KB + docs.
  No memory-write middleware, no memory-read middleware, no "auto-memory"
  anything. KB (`tools/HME/KB/`) and docs (`doc/`) are the only
  persistence surfaces.
- **Sub-agent duplication**: OVERDRIVE_VIA_SUBAGENT already dispatches
  reasoning through Claude's Agent tool. Dominance layer does not spawn
  parallel sub-agents for the same query -- that'd just spam the session
  budget.
- **Parallel inference racing**: `_reasoning_think` already races local
  vs cloud when `race_short=True`. No second racing layer here.

## What's in scope

- **Invisible tool wrapping.** Tool schemas the model sees remain
  identical to native. No description mutation, no name change. The
  agent cannot detect the wrapping from the tool surface. All HME
  enrichment happens in middleware that reads tool_result AFTER
  Claude Code dispatches the native tool -- the agent's next-turn
  context contains the enrichment without the tool call having looked
  different.
- **Response-phase gate absorption.** NEXUS / LIFESAVER /
  auto-completeness / exhaust_check currently fire as stop-hook
  `decision: block` imperatives the agent must react to. In dominance
  mode, these gates fire but their remediation runs in middleware --
  the gate's work gets DONE for the agent, and the agent's
  next-turn context reflects the completed remediation as findings,
  not as demands.
- **Desperation cache.** Proxy scans the current user turn for action
  verbs ("why did X break", "look at Y") and pre-fires the
  corresponding HME queries in parallel with the agent's inference.
  When the agent reaches for a tool, the result is already cached.
- **Bash intent translation.** The existing cwd_rewrite hook already
  rewrites `i/<tool>` paths. Extend to translate raw-bash intents into
  HME tool invocations where an HME equivalent exists and is strictly
  better -- silently, before the bash executes.

## Design principle

The agent types an imperative and gets a result. The path between those
two points may involve N HME calls that the agent never sees. The agent
cannot audit this path from inside a turn -- only the KB
(`i/trace`, `i/status`) reveals what happened, and that revelation is
opt-in archaeology, not a turn-time imperative.

Demand register ("YOU MUST") becomes forbidden in middleware output.
The tool acts; the agent reads the consequence.

## Proxy module conventions

### Imports: require from source, not barrels

Every `require()` in the proxy must import directly from the source module file,
never from a directory `index.js` barrel re-export — unless you are the
top-level entry point (`hme_proxy.js`, `hme_proxy_core.js`).

```js
// DO: import from the specific source file
const { markRouteCooldown } = require('./contexts/failure_policy/model_route_health');

// DON'T: import from a barrel that re-exports everything
const { markRouteCooldown } = require('./contexts/failure_policy');
```

**Why:** Barrel files pull in every transitive dependency of every sub-module
they re-export. A single `require('./contexts/failure_policy')` loads
`omni_failure_policy`, `hme_proxy_upstream_failure`, `hme_proxy_codex`,
`failure_classification`, `hme_proxy_connection_errors`, and `model_route_health`
— and `hme_proxy_connection_errors` in turn pulls in `response_transform`, which
pulls in `hme_proxy_anthropic_response`, which pulls in `overdrive_route`.
Importing the barrel from `overdrive_route` creates a circular chain.

### Lazy requires are allowed if documented

```js
function someHandler(...args) {
  const { helper } = require('./expensive_module');
  return helper(...args);
}
```

Lazy requires inside function bodies break import-time cycles. They are benign
as long as the module is never required at the top level of a cycle participant.

### Detecting violations

```bash
# Check for new circular dependencies (compares against baseline)
npm run hme:circular

# Run the import-sanity test (catches undefined-from-cycle imports)
npm run test:hme -- --test-name-pattern="no circular dependency"

# Update the baseline if you've resolved a known cycle
npm run hme:circular  # auto-updates baseline on resolution
```

### The baseline

`tools/HME/tests/fixtures/circular-baseline.txt` tracks the two known-benign
cycles (both use lazy requires to break import-time chains). Any new cycle
detected at import time will fail CI.

### Known-resolved cycle: failure_policy ↔ response_transform

`contexts/failure_policy/hme_proxy_connection_errors.js` once imported
`writeAnthropicStopSse` from `../response_transform` (the barrel). That barrel
imports `../../hme_proxy_anthropic_response`, which imports back from
`../contexts/failure_policy`, closing the loop. Fix: import directly from the
source leaf `../../legacy_swap_response` instead of the barrel. **Never
re-import from `../response_transform` from inside `failure_policy/`.**

# Canonical System Prompt

`canonical-system-prompt.md` is the project-curated system prompt that
replaces Claude Code's default when `HME_REPLACE_SYSTEM_PROMPT=1` in
`.env`. The replacement is wholesale -- Anthropic can rephrase or
restructure their default at will and our content still ships verbatim,
no regex anchors to drift.

Mechanism: [`tools/HME/proxy/middleware/01_replace_system.js`](middleware/01_replace_system.js).
mtime-cached, so edits to the canonical file take effect on the next
proxy-routed request after save (no proxy restart needed).

## What's in the canonical (and why)

15 lines / ~1.8KB -- down 93% from Claude Code's ~28KB default block 2.
Only content that the system-prompt layer can do (because CLAUDE.md and
HME hooks can't):

1. Identity statement + pointer to CLAUDE.md and HME hooks as the
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
adherence, Hypermeta workflow, etc.) is owned by `CLAUDE.md` (auto-loaded
into context) and HME's hook layer (proxy middleware + stop-chain
detectors like `exhaust_check` and `psycho_stop`, plus the `trample_gate`
proxy middleware for request-time interrupt-ack).

## Editing

Edit `canonical-system-prompt.md` directly. Every byte goes verbatim to
the model as the system prompt -- no comments, no markers, no header.
Keep additions narrow: anything CLAUDE.md or a hook can enforce belongs
there, not here. The system prompt is reserved for things only the
system prompt can do.

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

The `tools` array on every request is ~60KB+ -- bigger than the system
prompt. If you have tools you never use (`mcp__claude_ai_Google_Drive__*`,
`EnterWorktree`/`ExitWorktree`, `Monitor`, `RemoteTrigger`, `WebFetch`,
`WebSearch`, `CronCreate`/`Delete`/`List`, `PushNotification`, etc.),
drop them via [`filter_tools.js`](../tools/HME/proxy/middleware/03_filter_tools.js):

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

<!-- BEGIN_TELEMETRY_EVENTS -->
## HME Telemetry Events

Generated from `tools/HME/activity/event_registry.json`; edit the registry, then run:

```bash
python3 tools/HME/activity/render_events_doc.py
```

Reference for events emitted to `tools/HME/runtime/metrics/hme-activity.jsonl` (`activity`) and `tools/HME/runtime/metrics/hme-signals.jsonl` (`signal`).

### Host / prompt materialization

- **`system_prompt_replaced`** [activity] -- A host adapter replaced the outgoing system prompt with HME canonical prompt text.

### Cascade / prediction

- **`cascade_prediction_empty`** [activity] -- A cascade-prediction call returned no candidates.
- **`cascade_prediction_injected`** [activity] -- Cascade prediction middleware injected a prediction snippet.
- **`coherence_violation`** [activity] -- A read/edit or autocommit pattern matched a known-incoherent shape.

### Drift / regression signals

- **`consensus_divergence`** [activity] -- Two synthesis paths disagreed beyond the configured threshold.
- **`consensus_regression`** [activity] -- Consensus score dropped round-over-round.
- **`harvester_ignored`** [activity] -- The KB harvester rejected a candidate entry.
- **`hci_regression`** [activity] -- HCI score dropped by the configured regression threshold round-over-round.
- **`legendary_drift_preemptive`** [activity] -- The drift detector caught a known-bad pattern before it landed.

### File-system / edit lifecycle

- **`auto_brief_injected`** [activity] -- A pretooluse hook chained the KB briefing automatically.
- **`brief_recorded`** [activity] -- Read/Edit enrichment recorded a target brief before editing it.
- **`edit_without_brief`** [activity] -- A src/ Edit fired without a prior brief.
- **`file_watcher_filtered`** [activity] -- A watcher write was suppressed by ignore directories, extensions, or noise suffixes.
- **`file_written`** [activity] -- A watcher or proxy detected a write under an allow-listed path.
- **`kb_draft_written`** [activity] -- posttooluse_bash auto-wrote tmp/hme-learn-draft.json after a stable pipeline verdict.
- **`learn_suggested`** [activity] -- A hook suggested capturing novel findings into HME knowledge.
- **`productive_incoherence`** [activity] -- An edit intentionally entered uncovered territory while preserving traceability.

### Interactive / shortcut

- **`shortcut_expanded`** [activity] -- Proxy expanded an interactive shortcut command before forwarding.
- **`shortcut_followup_submitted`** [activity] -- Shortcut follow-up middleware submitted a queued continuation prompt.

### KB / context

- **`memory_redirect_flagged_preemptive`** [activity] -- Memory redirect middleware caught a deprecated memory-path write before hook handling.
- **`read_context`** [activity] -- Read context middleware enriched a Read result with KB titles.

### OMO bridge

- **`omo_bridge_error`** [activity] -- An OMO bridge call failed without crashing the native HME path.
- **`omo_checkout_evaluated`** [activity] -- Evaluated the configured OMO checkout/package and optional plugin entrypoint import.
- **`omo_context_injected`** [activity] -- Consumed OMO/HME context entries within a byte budget.
- **`omo_context_registered`** [activity] -- Registered a bounded context entry for OMO/HME context injection.
- **`omo_contract_validated`** [activity] -- Validated the HME/OMO compatibility contract against the resolved dependency.
- **`omo_dependency_resolved`** [activity] -- Resolved the configured OMO dependency source, version, commit, and status.
- **`omo_hook_invoked`** [activity] -- Invoked an OMO/OpenCode hook through the HME adapter and validation gate.
- **`omo_policy_checked`** [activity] -- An OMO-originated action was checked by HME policy.
- **`omo_pruning_completed`** [activity] -- Completed OMO dynamic-pruning or compatibility pruning with byte/message stats.
- **`omo_pruning_started`** [activity] -- Started OMO dynamic-pruning or compatibility pruning for a payload.
- **`omo_session_snapshot`** [activity] -- Read a read-only OMO/OpenCode session snapshot for HME use.
- **`omo_tool_blocked`** [activity] -- An OMO-originated tool/action was blocked by HME policy.
- **`omo_tool_bridge_exported`** [activity] -- Exported canonical HME tool descriptors into OMO-facing shape.
- **`omo_tool_invoked`** [activity] -- An OMO-originated tool action entered the HME bridge invocation path.

### Pipeline / coherence

- **`axis_rebalance_cost`** [activity] -- The coherence axis rebalancer applied a cost adjustment.
- **`axis_share_deviation`** [activity] -- A coherence axis share moved outside the target band.
- **`epoch_transition_auto_applied`** [activity] -- The pipeline auto-applied an epoch transition.
- **`idle_round`** [activity] -- A coherence-score window contained no human or agent file-written activity.
- **`pipeline_baseline_delta`** [activity] -- The pipeline recorded commit/file delta versus the previous run.
- **`pipeline_finished`** [signal] -- The posttooluse Bash hook observed pipeline completion.
- **`pipeline_run`** [activity] -- A pipeline run finished and recorded verdict, pass/fail, wall time, and HCI.
- **`pipeline_start`** [activity] -- A pipeline run started.
- **`review_complete`** [activity] -- i/review completed and captured a verdict.
- **`round_complete`** [activity] -- A pipeline round finished and closed the activity window for coherence calculations.

### Proxy / routing

- **`context_compaction`** [activity] -- Proxy compacted the request payload to fit upstream context limits.
- **`context_token_usage`** [activity] -- Proxy recorded token usage delta for a completed upstream request.
- **`context_window_retry`** [activity] -- Proxy retried after the upstream signaled context-window exhaustion.
- **`context_window_compact_requested`** [activity] -- Proxy requested a live-session compact cycle after upstream context-window exhaustion.
- **`model_route_quarantine`** [activity] -- Proxy marked an OmniRoute model route as cooldown after a credential or limit failure.
- **`omniroute_credential_failover`** [activity] -- Proxy failed over to the next OmniRoute chain target after a credential failure on the primary.
- **`request`** [activity] -- Generic upstream request envelope emitted by the proxy.
- **`upstream_midresponse_recovered`** [activity] -- Proxy recovered from a mid-response upstream error without surfacing it to the client.
- **`fingerprint_reset`** [activity] -- Proxy reset the request fingerprint or session routing state on demand.
- **`outbound_gate_compacted`** [activity] -- Outbound context gate compacted an interactive payload before upstream dispatch.
- **`outbound_gate_over_window`** [activity] -- Outbound context gate refused a known-over-window payload after compaction and reroute were exhausted.
- **`outbound_gate_rerouted`** [activity] -- Outbound context gate moved a payload to a larger-context route before dispatch.
- **`estimator_calibration`** [activity] -- Proxy recorded a token-estimator calibration sample comparing estimated vs actual input tokens.
- **`outbound_gate_compact_requested`** [activity] -- Outbound context gate requested a live-session compact cycle after an over-window verdict.
- **`transcript_compaction`** [activity] -- Transcript compactor rewrote an oversized session transcript file to reclaim context budget.

### Proxy request mutation

- **`unparsed_tool_call_recovered`** [activity] -- Request recovery guard rewrote an unparsed tool-call retry into a recoverable prompt.
- **`autocompact_fired_despite_disable`** [activity] -- The proxy observed an autocompact marker even though compaction disablement was expected.
- **`undefined_user_prompt_corrupted`** [activity] -- The proxy detected an undefined/corrupted final user prompt during request mutation.

### Round / session

- **`session_start`** [signal] -- The session-start lifecycle hook initialized a new session boundary.
- **`turn_complete`** [activity, signal] -- The Stop lifecycle hook marked the end of a chat turn.
- **`turn_start`** [signal] -- The UserPromptSubmit lifecycle hook marked the start of a chat turn.

### Subagent / supervisor lifecycle

- **`adhoc_spawn`** [activity] -- The supervisor spawned an ad-hoc child process.
- **`agent_jobs_empty_result`** [activity] -- Agent-job capture wrote an empty Agent result for a queued HME task.
- **`agent_jobs_result_captured`** [activity] -- Agent-job capture wrote a non-empty Agent result for a queued HME task.
- **`child_adopted`** [activity] -- The supervisor adopted an existing child PID after restart or discovery.
- **`child_exited`** [activity] -- A supervised child exited cleanly.
- **`child_force_killed`** [activity] -- A child required SIGKILL after SIGTERM did not resolve it.
- **`child_hang_killed`** [activity] -- A child was killed for hanging past its timeout.
- **`child_restart_limit`** [activity] -- A child exceeded restart attempts and the supervisor stopped trying.
- **`child_restarted`** [activity] -- The supervisor restarted a failed child.
- **`child_started`** [activity] -- A supervised child process started successfully.
- **`child_unhealthy`** [activity] -- A child failed health check and restart handling is pending.
- **`mcp_hang_kill`** [activity] -- An MCP server was killed for hanging.
- **`proxy_emergency`** [activity] -- The proxy entered an emergency state requiring backoff or intervention.
- **`proxy_emergency_cleared`** [activity] -- The emergency valve auto-cleared after the backoff window elapsed.
- **`subagent_clean_gate_failed`** [activity] -- The subagent clean gate found advisory check failures for files mentioned by an Agent result.
- **`subagent_clean_gate_ok`** [activity] -- The subagent clean gate passed its advisory checks for files mentioned by an Agent result.
- **`supervisor_spawn_error`** [activity] -- The supervisor failed to spawn a child process.

### Tool / lifecycle

- **`edit_failure_raw_result_replaced`** [activity] -- Proxy substituted a raw failed Edit tool_result with a synthesized error envelope.

### Tool / proxy lifecycle

- **`bash_error_surfaced`** [activity] -- Bash enrichment extracted an error snippet from a bash tool result.
- **`bg_dominance_resolved`** [activity] -- Background dominance resolved a backgrounded i/* stub into real output.
- **`bg_dominance_timeout`** [activity] -- Backgrounded resolution exceeded its wait window.
- **`bias_bounds_snapshot_queued`** [activity] -- Post-write side effects queued a bias-bounds snapshot after a relevant edit.
- **`boilerplate_stripped`** [activity] -- The proxy removed boilerplate prefixes from tool output.
- **`cache_control_normalized`** [activity] -- The proxy promoted short cache_control TTLs to avoid upstream ordering failures.
- **`dir_context`** [activity] -- Directory-context middleware injected directory-intent context.
- **`dominance_prefetch_fired`** [activity] -- Dominance prefetch warmed cache for a likely-next call.
- **`edit_context`** [activity] -- Edit-context middleware injected pre-edit KB context.
- **`edit_failure_context_appended`** [activity] -- Edit-failure middleware appended file context after an edit could not apply.
- **`empty_tool_result_marked`** [activity] -- The proxy tagged an empty tool result body as SUCCESS or FAIL.
- **`enricher_acted_upon`** [activity] -- A downstream tool call referenced an identifier injected by an enricher.
- **`enricher_fired`** [activity] -- An enricher middleware appended content to a tool result.
- **`hme_continuation`** [activity] -- The proxy emitted a continuation step on a multi-step HME tool flow.
- **`hme_continuation_complete`** [activity] -- A multi-step HME continuation completed.
- **`hme_log_error_escalated`** [activity] -- HME log watermark escalated ERROR lines into the lifesaver error log.
- **`hme_tool_result`** [activity] -- The proxy received a result for an HME tool call.
- **`inference_call`** [activity] -- A local-inference subprocess was invoked.
- **`jurisdiction_inject`** [activity] -- The proxy injected a hypermeta jurisdiction warning into agent context.
- **`lifesaver_injected`** [activity] -- Lifesaver middleware injected an actionable error or autocommit failure into the request.
- **`lifesaver_inject_suppressed`** [activity] -- Lifesaver middleware throttled a non-strict-mode injection within the dampening interval.
- **`lifesaver_watermark_failed`** [activity] -- Lifesaver middleware could not advance its error-log watermark.
- **`mcp_fail_escalated`** [activity] -- MCP fail-scan escalated FAIL lines into the lifesaver error log.
- **`mcp_tool_call`** [activity] -- The agent invoked an MCP tool.
- **`memory_redirect`** [activity] -- Middleware redirected a memory-directory write attempt.
- **`middleware_warning`** [activity] -- Middleware recorded a non-fatal warning in telemetry instead of printing into tool output.
- **`neighborhood_enrichment`** [activity] -- Grep/glob neighborhood middleware appended sibling-file context.
- **`nexus_cleared`** [activity] -- The NEXUS state file was reset, typically at session start.
- **`policy_rewrite`** [activity] -- Policy middleware rewrote a tool payload while preserving the allowed operation.
- **`post_write_side_effect_failed`** [activity] -- A post-write side-effect hook failed and emitted its diagnostic surface.
- **`secret_sanitized`** [activity] -- Secret sanitizer middleware redacted credential patterns from tool output.
- **`semantic_redundancy_stripped`** [activity] -- The proxy removed redundant sentences from a tool result before display.
- **`skill_reminder_stripped`** [activity] -- The proxy removed repeated skill reminders or compacted low-signal Stop-hook feedback.
- **`status_inject`** [activity] -- i/status output was auto-injected as a system reminder.
- **`stop_reminder_inject`** [activity] -- Stop-reminder middleware injected a compact continuity reminder.
- **`todo_status_suppressed`** [activity] -- Todo status filtering suppressed repeated todo-state context.
- **`tool_call`** [activity] -- Generic proxy bookkeeping marker for a completed tool invocation.
- **`upstream_conn_error`** [activity] -- A TCP/TLS-level failure occurred before an upstream HTTP response.
- **`upstream_error`** [activity] -- The proxy classified an upstream HTTP or SSE response as failed.
- **`upstream_midresponse_error`** [activity] -- The upstream began streaming and then failed or closed prematurely.
- **`upstream_stream_timeout_retry`** [activity] -- The proxy retried an upstream stream after a timeout-class failure.
- **`web_tool_call`** [activity] -- The agent invoked a WebSearch or WebFetch tool.
- **`web_tool_failure`** [activity] -- Web tool enrichment observed a repeated failure for a target.

### Universal hook

- **`universal_hook_adapter_error`** [activity] -- Universal hook adapter translation failed without blocking live flow.
- **`universal_hook_chat_params_error`** [activity] -- Universal chat.params routing failed open without corrupting the request.
- **`universal_hook_observation_error`** [activity] -- Optional universal observation routing failed open.
- **`universal_hook_observation_routed`** [activity] -- A low-risk universal observation phase routed effect-only telemetry.
- **`universal_hook_observation_skipped`** [activity] -- Universal observation routing was skipped because it was disabled or unavailable.
- **`universal_hook_shadow_match`** [activity] -- Native and universal shadow decisions matched on kind and reason code.
- **`universal_hook_shadow_mismatch`** [activity] -- Native and universal shadow decisions diverged by kind or reason code.

<!-- END_TELEMETRY_EVENTS -->

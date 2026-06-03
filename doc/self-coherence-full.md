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
- Activity event schema: [../tools/HME/activity/EVENTS.md](../tools/HME/activity/EVENTS.md)
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

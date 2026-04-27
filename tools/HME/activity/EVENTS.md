# HME Activity Events

Reference for event names emitted into `output/metrics/hme-activity.jsonl`.
Each entry: emitter → meaning → triggers HME consumes for.

Add a new event: emit it via `tools/HME/activity/emit.py --event=<name>` (Python/shell)
or `ctx.emit({event: '<name>', …})` (JS proxy middleware), then add a one-line entry below.

A verifier (`activity-events-doc-sync`) compares the live emit-call set against this
file's listed events and FAILs if they drift.

## File-system / edit lifecycle

- **`file_written`** — fs_watcher detected a write under an allow-listed path. Powers the read-coverage / activity-window calculation.
- **`file_watcher_filtered`** — a write was suppressed (ignore_dirs, ignore_exts, noise suffix). Used to debug "why didn't my edit show up."
- **`brief_recorded`** — agent ran `i/hme-read` on a target before editing it. Drops the file's "needs-brief" flag in NEXUS state.
- **`auto_brief_injected`** — pretooluse_edit hook chained the KB briefing automatically. Counterpart to manual `brief_recorded`.
- **`edit_without_brief`** — a `/src/` Edit fired without a prior brief. Surfaces as a soft warning in selftest.

## KB / context

- **`read_context`** — `read_context.js` middleware enriched a Read tool result with KB titles.
- **`memory_redirect_flagged_preemptive`** — `memory_redirect.js` middleware caught a write to the deprecated `.claude/projects/*/memory/` path before the hook fired.

## Tool / proxy lifecycle

- **`bash_error_surfaced`** — `bash_enrichment.js` extracted an error snippet from a bash tool result.
- **`bg_dominance_resolved`** — `background_dominance.js` resolved a backgrounded `i/*` stub into its real output.
- **`bg_dominance_timeout`** — backgrounded resolution exceeded its wait window.
- **`dominance_prefetch_fired`** — `dominance_prefetch.js` warmed cache for a likely-next call.
- **`web_tool_call`** — agent invoked a WebSearch / WebFetch tool.
- **`mcp_tool_call`** — agent invoked an MCP tool.
- **`tool_call`** — generic tool-invocation marker (proxy bookkeeping).
- **`hme_tool_result`** — proxy received a result for an HME tool call.
- **`hme_continuation`** — proxy emitted a continuation step on a multi-step HME tool flow.
- **`hme_continuation_complete`** — multi-step continuation finished.
- **`enricher_acted_upon`** — `context_budget.js` middleware detected a downstream tool call that referenced an identifier injected by a prior enricher. Used for enricher effectiveness tracking.
- **`enricher_fired`** — any enricher middleware appended content to a tool result.
- **`injection_influence`** — proxy detected influence of an injected hint on the next tool call.
- **`status_inject`** — `i/status` output was auto-injected as a system reminder.
- **`jurisdiction_inject`** — hypermeta jurisdiction warning injected into agent context.
- **`neighborhood_enrichment`** — `grep_glob_neighborhood.js` middleware appended sibling-file context.
- **`semantic_redundancy_stripped`** — proxy removed redundant sentences from a tool result before display.
- **`boilerplate_stripped`** — proxy removed boilerplate prefixes from tool output.
- **`secret_sanitized`** — `secret_sanitizer.js` redacted credential patterns from tool output.
- **`memory_redirect`** — middleware redirected a memory-directory write attempt.
- **`nexus_cleared`** — NEXUS state file reset (typically session start).
- **`dir_context`** — `dir_context.js` middleware injected directory-intent context.
- **`edit_context`** — `edit_context.js` middleware injected pre-edit KB context.

## Subagent / supervisor lifecycle

- **`adhoc_spawn`** — supervisor spawned an ad-hoc child process.
- **`child_started`** — supervised child process started successfully.
- **`child_adopted`** — supervisor adopted an existing child PID (e.g. after restart).
- **`child_exited`** — supervised child exited cleanly.
- **`child_unhealthy`** — child failed health check; restart pending.
- **`child_hang_killed`** — child killed for hanging past timeout.
- **`child_force_killed`** — SIGKILL after SIGTERM didn't resolve.
- **`child_restarted`** — supervisor restarted a failed child.
- **`child_restart_limit`** — child exceeded restart attempts; supervisor giving up.
- **`mcp_hang_kill`** — MCP server killed for hanging.
- **`supervisor_spawn_error`** — supervisor failed to spawn a child.
- **`proxy_emergency`** — proxy hit an emergency state requiring intervention.
- **`inference_call`** — local-inference subprocess invoked.
- **`cascade_prediction_injected`** — cascade prediction middleware injected a prediction snippet.

## Cascade / prediction

- **`cascade_prediction_empty`** — a cascade-prediction call returned no candidates.
- **`coherence_violation`** — read/edit pattern matched a known-incoherent shape.

## Buddy / synthesis

- **`buddy_init`** — buddy subagent session initialized.

## Drift / regression signals

- **`hci_regression`** — HCI score dropped by ≥3 points round-over-round.
- **`consensus_divergence`** — two synthesis paths disagreed.
- **`consensus_regression`** — consensus score dropped round-over-round.
- **`legendary_drift_preemptive`** — drift detector caught a known-bad pattern before it landed.
- **`harvester_ignored`** — KB harvester rejected a candidate entry.

## Pipeline / coherence

- **`axis_rebalance_cost`** — coherence axis rebalancer applied a cost adjustment.
- **`axis_share_deviation`** — coherence axis share moved outside the target band.
- **`epoch_transition_auto_applied`** — pipeline auto-applied an epoch transition.
- **`review_complete`** — `i/review` completed; verdict captured.

## Round / session

- **`round_complete`** — emitted by the agent (or stop hook) at the end of a round; closes the activity window for coherence calculations. **Required** before reading `i/status mode=music_truth` to avoid contaminated scores.
- **`state_advance`** — onboarding state machine transitioned (recorded with `from`/`to` fields).
- **`onboarding_init`** — fresh session started; state initialized.

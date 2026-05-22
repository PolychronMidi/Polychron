# HME Telemetry Events

Generated from `event_registry.json`; edit the registry, then run:

```bash
python3 tools/HME/activity/render_events_doc.py
```

Reference for events emitted to `tools/HME/runtime/metrics/hme-activity.jsonl` (`activity`) and `tools/HME/runtime/metrics/hme-signals.jsonl` (`signal`).

## Cascade / prediction

- **`cascade_prediction_empty`** [activity] -- A cascade-prediction call returned no candidates.
- **`cascade_prediction_injected`** [activity] -- Cascade prediction middleware injected a prediction snippet.
- **`coherence_violation`** [activity] -- A read/edit or autocommit pattern matched a known-incoherent shape.

## Drift / regression signals

- **`consensus_divergence`** [activity] -- Two synthesis paths disagreed beyond the configured threshold.
- **`consensus_regression`** [activity] -- Consensus score dropped round-over-round.
- **`harvester_ignored`** [activity] -- The KB harvester rejected a candidate entry.
- **`hci_regression`** [activity] -- HCI score dropped by the configured regression threshold round-over-round.
- **`legendary_drift_preemptive`** [activity] -- The drift detector caught a known-bad pattern before it landed.

## File-system / edit lifecycle

- **`auto_brief_injected`** [activity] -- A pretooluse hook chained the KB briefing automatically.
- **`brief_recorded`** [activity] -- Read/Edit enrichment recorded a target brief before editing it.
- **`edit_without_brief`** [activity] -- A src/ Edit fired without a prior brief.
- **`file_watcher_filtered`** [activity] -- A watcher write was suppressed by ignore directories, extensions, or noise suffixes.
- **`file_written`** [activity] -- A watcher or proxy detected a write under an allow-listed path.
- **`kb_draft_written`** [activity] -- posttooluse_bash auto-wrote tmp/hme-learn-draft.json after a stable pipeline verdict.
- **`learn_suggested`** [activity] -- A hook suggested capturing novel findings into HME knowledge.
- **`productive_incoherence`** [activity] -- An edit intentionally entered uncovered territory while preserving traceability.

## Interactive / shortcut

- **`shortcut_expanded`** [activity] -- Proxy expanded an interactive shortcut command before forwarding.

## KB / context

- **`memory_redirect_flagged_preemptive`** [activity] -- Memory redirect middleware caught a deprecated memory-path write before hook handling.
- **`read_context`** [activity] -- Read context middleware enriched a Read result with KB titles.

## OMO bridge

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

## Pipeline / coherence

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

## Proxy / routing

- **`context_compaction`** [activity] -- Proxy compacted the request payload to fit upstream context limits.
- **`context_token_usage`** [activity] -- Proxy recorded token usage delta for a completed upstream request.
- **`context_window_retry`** [activity] -- Proxy retried after the upstream signaled context-window exhaustion.
- **`model_route_quarantine`** [activity] -- Proxy marked an OmniRoute model route as cooldown after a credential or limit failure.
- **`omniroute_credential_failover`** [activity] -- Proxy failed over to the next OmniRoute chain target after a credential failure on the primary.
- **`request`** [activity] -- Generic upstream request envelope emitted by the proxy.
- **`upstream_midresponse_recovered`** [activity] -- Proxy recovered from a mid-response upstream error without surfacing it to the client.

## Round / session

- **`session_start`** [signal] -- The session-start lifecycle hook initialized a new session boundary.
- **`turn_complete`** [activity, signal] -- The Stop lifecycle hook marked the end of a chat turn.
- **`turn_start`** [signal] -- The UserPromptSubmit lifecycle hook marked the start of a chat turn.

## Subagent / supervisor lifecycle

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

## Tool / lifecycle

- **`edit_failure_raw_result_replaced`** [activity] -- Proxy substituted a raw failed Edit tool_result with a synthesized error envelope.

## Tool / proxy lifecycle

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

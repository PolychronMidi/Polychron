# Plan

## Status legend

- proposed: drafted, awaiting user decision
- approved: user approved; safe to implement
- denied: user rejected; do not implement
- done: implemented + verified

## Proposed: HME as a self-coherence field substrate

North star: every HME surface should answer, at all times:

- What is true?
- How do we know?
- Is it current?
- What changed since last proof?
- What should happen next?
- What would make this claim stale?

A tool, verifier, alert, score, warning, KB entry, or subagent result that cannot answer those questions is not self-coherent.

## MVP vertical slice

Before broad migration, prove the smallest complete loop:

1. One producer emits a schema-valid claim.
2. One status surface consumes and displays it.
3. One relevant file edit invalidates it.
4. One rerun refreshes it.
5. CI proves both current and stale cases.

The first slice should use comment-bloat because it has clear evidence, invalidators, repair action, and recent regressions.

Acceptance for the MVP slice:

- claim schema rejects malformed claims
- comment-bloat producer emits claim with evidence hash and invalidators
- status surface shows current vs stale state correctly
- touching a scoped source file marks the claim stale
- rerunning the audit refreshes the claim
- tests cover current, stale, and malformed claim cases

## 1. Claim atoms below file-level state

Every invariant, alert, warning, score, and status line should emit a structured claim record.

Required fields:

```json
{
  "schema_version": "1.0.0",
  "claim_id": "comment-bloat.fail-count.zero",
  "subject_uri": "repo://tools/HME/scripts/audit-comment-bloat.py",
  "producer": "audit-comment-bloat.py",
  "producer_version": "git:<sha>",
  "status": "pass|warn|fail|error|stale|unknown",
  "severity": "info|warn|blocker",
  "confidence": 0.98,
  "evidence_uri": "repo://runtime/hme-claims/comment-bloat.json",
  "evidence_hash": "sha256:...",
  "scope": ["repo://src", "repo://tools/HME"],
  "invalidator_keys": ["tracked_code_edit", "verifier_edit"],
  "generated_at": "2026-06-13T00:00:00Z",
  "expires_at": null,
  "repair": "manually condense prose comments to <=2 intent-preserving lines",
  "regression_tests": ["comment_bloat_audit.test.js"],
  "retirement_condition": "comment-bloat policy removed from AGENTS.md",
  "supersedes": []
}
```

Goal: prevent stale claims, stale alerts, stale goals, and stale status from masquerading as current truth.

## 2. Invalidator registry and currentness protocol

Currentness is a join between a claim and normalized invalidator events.

Required invalidator registry entries:

| key | scope | default effect |
| --- | --- | --- |
| `tracked_code_edit` | repo file paths | stale matching code/comment claims |
| `verifier_edit` | verifier source paths | stale claims produced by that verifier |
| `policy_edit` | policy source paths | stale policy/tool-surface claims |
| `test_edit` | test source paths | stale claims whose proof depends on tests |
| `kb_source_edit` | KB source file/symbol paths | stale related KB entries |
| `pipeline_run` | pipeline summary path | refresh pipeline verdict claims |
| `tool_response_defect` | tool/session id | stale tool-quality aggregate claims |
| `agent_launch` | agent request id | refresh or fail fork-proof claims |

Unknown relevant invalidators must make a claim stale rather than current.

Every status, alert, verdict, and score must carry:

- `generated_at`
- `source_file_or_command`
- `invalidated_by`
- `last_success_after_last_failure?`

Examples:

- Autocommit alert is current only if failure timestamp is newer than last successful autocommit.
- Pipeline verdict is current only if summary timestamp is newer than the last relevant source edit.
- HCI score is current only if verifier snapshot timestamp is newer than the last verifier-affecting edit.
- Comment-bloat audit is current only if audit timestamp is newer than the last tracked code/comment edit.
- Agent output is current only if produced with fork-context proof.

## 3. Tool-response intelligence

HME should not log every mildly imperfect response. It should log contract violations and below-threshold responses.

Ratings:

- `10/10`: concise, current, actionable, bounded, no stale warnings, no context bloat
- `8/10`: correct but noisy or missing next action
- `5/10`: useful data but too much output, stale state, or ambiguous success
- `0/10`: misleading, stale, false success, or context attack

Logging policy:

- Always log contract violations.
- Log ratings below the configured threshold.
- Aggregate minor recurring `8/10` defects instead of spamming one event per response.
- Every logged defect needs owner, reproduction, repair status, and waiver expiry.

Record shape:

```json
{
  "tool": "i/status state",
  "rating": 8,
  "defect_class": "stale_advisory",
  "defect": "showed obsolete hot-reload metric",
  "owner": "state-panel.py",
  "reproduction": "i/status state after dual-slot runtime enabled",
  "repair_status": "fixed",
  "waiver_expires_at": null,
  "regression": "state_panel_freshness_contract.test.js"
}
```

HCI should ingest tool-response quality. Noisy tools lower self-coherence.

## 4. Agent ecology and fork-context proof

Every subagent launch must carry fork-context proof:

```json
{
  "agent_request_id": "...",
  "source_session_tokens": 350000,
  "agent_context_tokens": 340000,
  "fork_delta": "bounded task prompt + HME routing prelude only",
  "raw_context_fresh": false,
  "nested_agent_allowed": false,
  "max_files": 8,
  "max_words": 900,
  "telemetry_generated_at": "2026-06-13T00:00:00Z"
}
```

Block or reroute subagent starts when:

```text
agent_context_tokens / parent_context_tokens < configured_ratio
```

Failure behavior:

- Missing or stale token telemetry fails closed or reroutes with one terse actionable error.
- Prompt text never counts as proof.
- Emergency allowlists require owner, expiry, reason, and audit trail.
- Nested Agent calls inside multi-tool wrappers remain blocked.

## 5. Comment coherence instead of blind line counting

Keep line-count gates but classify semantic kind:

- type metadata: exempt
- generated docs: exempt if marked generated
- directives: exempt when narrow and tool-consumed
- 1-2 line rationale: ok
- 3-4 line prose: warn
- 5+ line prose: fail
- 90+ char prose: long

Every exemption must explain why it is not bloat.

Comment scoring should consider:

- Does this say something the code cannot?
- Does it name intent, invariant, or danger?
- Is it stale relative to code?
- Can it be shortened without losing meaning?

Required negative fixtures:

- prose `/* ... */` block fails at 5+ lines
- JSDoc type metadata is exempt
- long prose comment fails
- generated block is exempt only with generated marker
- stale prose comment fails when claim graph shows code drift

## 6. Pipeline verdict split

Pipeline summaries must separate:

```json
{
  "behavioral_verdict": "STABLE",
  "diagnostic_verdict": "PASS|WARN|FAIL",
  "self_coherence_verdict": "PASS|WARN|FAIL",
  "exit_policy": "fail if diagnostic/self_coherence fail unless explicitly allowlisted"
}
```

A musical STABLE verdict must not hide diagnostic or self-coherence failures.

Required negative fixtures:

- `STABLE` plus diagnostic failure exits nonzero or marks diagnostic verdict FAIL.
- `STABLE` plus self-coherence failure exits nonzero or marks self-coherence verdict FAIL.
- allowlisted nonfatal step includes owner, reason, expiry, and test.

## 7. HCI split-brain fix

Split HCI into distinct scores:

- `HCI-Verifier`: are HME invariants and verifiers healthy?
- `HCI-Behavior`: did the agent read before writing and avoid coherence violations?
- `HCI-Tooling`: were tool responses bounded/current/actionable?
- `HCI-Temporal`: are claims fresh relative to invalidators?
- `HCI-Composite`: phase-weighted aggregate

Add phase awareness:

```text
phase=maintenance | composition | audit | exploration | repair
```

Maintenance sessions with many deliberate edits should not be interpreted like composition sessions.

## 8. KB semantic checksums

Every KB entry should include:

- source files
- symbols
- tests
- decision date
- supersession condition
- confidence
- evidence hash

If code changes, relevant KB entries become possibly stale automatically.

Required negative fixture:

- editing a source symbol referenced by a KB entry marks that entry possibly stale until refreshed or superseded.

## 9. Evidence and telemetry data minimization

The self-coherence substrate must not become a privacy, storage, or context-bloat source.

Rules:

- Store hashes, URIs, timestamps, and bounded excerpts instead of raw prompts or large logs.
- Redact secrets before evidence capture.
- Retain large evidence by path with size caps and expiry.
- Token telemetry stores counts and route metadata, not raw request payloads.
- Claim graph edges store identifiers, not full transcript text.

## 10. Claim graph

Represent HME as a graph:

```text
file -> verifier -> policy -> test -> KB entry -> alert -> repair
```

`i/why mode=claim <thing>` should answer:

- Why does this rule exist?
- What bug birthed it?
- What tests preserve it?
- What can retire it?
- What breaks if removed?

## 11. Verifier self-doubt

Every verifier periodically answers:

- Am I still measuring the intended thing?
- Am I blind to a known bypass?
- Am I producing false positives?
- Am I producing false negatives?
- Is my output actionable?
- Is my failure mode fail-loud?
- Can I be gamed by ceremony?

Meta-rule:

- every warning has proof of usefulness
- every rule has a death condition
- every repair has a regression
- every regression has lineage
- every lineage has purpose
- every purpose has currentness proof

## Reordered build sequence

1. Inventory existing HME statuses, alerts, scores, warnings, KB entries, and verdicts.
2. Add `tools/HME/schemas/coherence-claim.schema.json`.
3. Add claim writer/reader helpers and schema validation tests.
4. Add invalidator registry and currentness helper: `isCurrent(claim, invalidators)`.
5. Add CI/HME gate for schema-invalid claims, stale-current claims, missing freshness proof, and missing repair path.
6. Implement MVP vertical slice for comment-bloat claims.
7. Add status surface for current vs stale claim state.
8. Migrate one HCI verifier to claim output.
9. Split HCI into Verifier, Behavior, Tooling, Temporal, and Composite scores.
10. Add phase awareness for HCI scoring.
11. Split pipeline verdict into behavioral, diagnostic, and self-coherence verdicts.
12. Upgrade comment coherence classification fixtures and policy wiring.
13. Add tool-response rating ledger plus expiring waiver ledger for contract violations and below-threshold responses.
14. Define OmniRoute/token telemetry source and fail-closed behavior.
15. Add Agent fork-proof check using actual context-token ratio.
16. Add KB semantic checksum fields and stale-on-source-edit detection.
17. Add claim graph storage/indexing.
18. Add claim graph explorer: `i/why mode=claim <thing>`.
19. Add verifier self-doubt audit.
20. Add meta-rule audit for usefulness proof, repair regression, lineage, purpose, and currentness proof.
21. Add data minimization audits for claim/evidence/token telemetry.

## Acceptance criteria

- No stale alert can present itself as current without a freshness proof.
- No contract-violating or below-threshold tool response disappears without a logged defect or explicit expiring waiver.
- No subagent can launch without fork-context proof or bounded task shape.
- Missing fork telemetry fails closed or reroutes with one actionable error.
- Pipeline STABLE cannot hide diagnostic or self-coherence failures.
- HCI reports verifier health separately from agent behavior, tooling quality, and temporal freshness.
- Comment-bloat policy distinguishes semantic metadata from prose bloat.
- KB entries become possibly stale when referenced source files/symbols change.
- Claim schema rejects malformed claims.
- Evidence stores hashes/URIs/bounded excerpts, not raw prompts or secrets.
- Each new rule has a regression test and a retirement condition.

## Phase 15 (done) -- Project boundary map + hot/cold path minimalism

Historical evidence anchor retained for `tools/HME/config/phase-evidence.json`; it is not part of the proposed self-coherence field substrate work.

## Phase 16 (done) -- Phase-inference firewall

Historical evidence anchor retained for `tools/HME/config/phase-evidence.json`; it is not part of the proposed self-coherence field substrate work.

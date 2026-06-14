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

A tool, verifier, alert, score, warning, or KB entry that cannot answer those questions is not self-coherent.

### 1. Claim atoms below file-level state

Every invariant, alert, warning, score, and status line should emit a structured claim record:

```json
{
  "claim": "comment-bloat FAIL count is zero",
  "owner": "audit-comment-bloat.py",
  "evidence": "latest audit JSON path + timestamp",
  "scope": ["src", "tools/HME"],
  "freshness": "valid until next tracked code/comment edit",
  "repair": "manual condense block to <=2 lines preserving intent",
  "regression_tests": ["comment_bloat_audit.test.js"],
  "retirement_condition": "policy removed from AGENTS.md"
}
```

Goal: prevent stale claims, stale alerts, stale goals, and stale status from masquerading as current truth.

### 2. Currentness protocol

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

### 3. Tool-response intelligence

Every HME/tool response should self-rate:

- `10/10`: concise, current, actionable, bounded, no stale warnings, no context bloat
- `8/10`: correct but noisy or missing next action
- `5/10`: useful data but too much output, stale state, or ambiguous success
- `0/10`: misleading, stale, false success, or context attack

Record low-quality responses:

```json
{
  "tool": "i/status state",
  "rating": 8,
  "defect": "showed obsolete hot-reload metric",
  "repair_status": "fixed",
  "regression": "state_panel_freshness_contract.test.js"
}
```

HCI should ingest tool-response quality. Noisy tools lower self-coherence.

### 4. Agent ecology and fork-context proof

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
  "max_words": 900
}
```

Block or reroute subagent starts when:

```text
agent_context_tokens / parent_context_tokens < configured_ratio
```

Prompt text is not proof. OmniRoute/token telemetry is proof.

### 5. Comment coherence instead of blind line counting

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

### 6. Pipeline verdict split

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

### 7. HCI split-brain fix

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

### 8. KB semantic checksums

Every KB entry should include:

- source files
- symbols
- tests
- decision date
- supersession condition
- confidence

If code changes, relevant KB entries become possibly stale automatically.

### 9. Claim graph

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

### 10. Verifier self-doubt

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

## Build sequence

1. Add `tools/HME/schemas/coherence-claim.schema.json`.
2. Upgrade HCI verifier output to include claim/evidence/freshness/repair/retirement fields.
3. Add shared currentness helpers: `isCurrent(claim, invalidators)`.
4. Add tool-response rating ledger for HME tool outputs rated below 10/10.
5. Add Agent fork-proof check using actual context-token ratio, not prompt text.
6. Split pipeline verdict into behavioral/diagnostic/self-coherence verdicts.
7. Upgrade comment coherence classification to distinguish prose/type/generated/directive/rationale/stale-doc.
8. Add HCI phase awareness.
9. Add claim graph explorer: `i/why mode=claim <thing>`.
10. Add verifier self-doubt audit.

## Acceptance criteria

- No stale alert can present itself as current without a freshness proof.
- No tool response rated below 10/10 disappears without a logged defect or explicit waiver.
- No subagent can launch without fork-context proof or bounded task shape.
- Pipeline STABLE cannot hide diagnostic or self-coherence failures.
- HCI reports verifier health separately from agent behavior and temporal freshness.
- Comment-bloat policy distinguishes semantic metadata from prose bloat.
- Each new rule has a regression test and a retirement condition.

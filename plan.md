# Plan

Driver (orchestrator) + peers confer; durable, user-approvable proposals land
here. Nothing in this file is implemented until the user marks it approved.

## Status legend
- proposed: drafted from conferral, awaiting user decision
- approved: user approved; safe to implement
- denied: user rejected; do not implement
- done: implemented + verified

## Standing constraints (binding across all phases)
- Cost-control charter (CEO directive): cost controls exist ONLY to improve output
  quality and prevent runaway/incoherent agents. They must NEVER abridge an agent's
  work when it is reasonable to go in depth. Inter-agent communication -- including
  multi-turn back-and-forth -- is sometimes necessary; budgets must NOT abridge that
  synergy. Any cap that would truncate reasonable depth or needed peer dialogue is a
  bug, not a feature; calibration (decision-impact weight, anti-inflation) focuses
  work, never suppresses legitimate deep work.
- Mesh model: peers are driver FORKS with FULL inherited context and FULL tools;
  dispatch stays sequential (no fan-out); tool filtering, where wanted, is
  centralized at the proxy (HME_FILTER_TOOLS_DROP). Honor every hook/guard at its
  intent -- never workaround-appease. No context-burn ceremony on routine reviews.
- Anti-duplication: a new construct must not duplicate or circumvent a first-class
  system (work -> TODO; messages -> channels; data -> data files beside consumers;
  prose -> the limited canonical docs). Lesson from Phase 13's retirements.

## History
- Phases 1-12 (git history): coherence organs/policy/immune fixes, the I1-I3 comms
  substrate, and the fork/full-tool red/blue/purple mesh build-out (iterations
  6-12) -- ask-peer, dispatch guard, team_agent_router, review harness, proxy
  filter_tools middleware, event-kernel host entry/adapters.
- Phase 13 (myth0s: calibrated-audit integration + scale-out) -- DONE. Durable
  wins: A1-A7 calibrated-audit discipline (live in every peer dispatch), B1
  control-plane hardening (~10 grounded P1 fixes + regression tests across pre-write
  gate, state registry, stop-chain, session-state, transcript compaction, proxy
  request mutation, tool-result semantics), E1 review-briefs-as-data composed into
  channel messages with live source inlined. Retired once lessons were captured:
  the capsule .md directory (-> briefs + channels), the coverage map + status/select
  tooling (-> TODO ledger + briefs), the score/eval/telemetry demonstrators
  (-> lessons recorded; charter binding). F1 enforcement declined (would fail-closed
  on legit work or be theater). Full record: `git log -- plan.md`.

## Phase 14 (done) -- Mesh refinement, then HME self-coherence expansion

Status: `done` (implemented + verified). Executed via deep red/blue/purple mesh
consultation, tracked in TODO Set 27 (#23-#28, archived to log/todo/set27.md). Every
workstream landed grounded fixes with regression tests; HCI held ~99 with no FAIL.
Durable wins: WS1 round-reliability contract (typed durable progress_result records,
named-role targets, per-peer reply capture, stale-output cleanup, failure-aware
round-finish, FAILED reader state -- round_status/round_runner_contract tests); WS2
mesh signal-discipline (guard refunds budget on pre-send capsule/context denies,
driver->lead channel labeled to roles.json truth, chained-handoff reply cap raised so
cross-exam dialogue is never truncated); WS3 HCI-integrity hardening (registry
preflight fails closed on duplicate names / non-finite-or-<=0 weights, central
status/score normalization so a FAIL can't read green, verifier_self_coverage no
longer self-exempt, unknown waivers now FAIL -- hci_integrity test). WS4 ran entirely
through existing ledgers. Native-Agent-fallback finding DECLINED with contradictory
evidence (#27); cap-divergence resolved via single-source cap (#28). The original
intent stands: mesh refined first; no `src/` product focus this phase.

Theme: harden the red/blue/purple mesh until peer rounds are reliable, observable,
grounded, and non-bloating; then apply that refined mesh to expand and sharpen the
HME verifier / self-coherence suite.

### Workstream 1 -- Mesh round reliability contract
- Scope: every first-class peer round must expose durable per-step progress, durable
  per-peer reply capture, stale-output cleanup, and typed failure states.
- First step: make the progress-ledger/status-reader contract a tested invariant for
  the round runners that remain in use, not an ad hoc rescue patch.
- Guardrail: no blind dispatch, no repeated launch spam, no claims of notifications
  from mechanisms that cannot notify, and no parallel runner framework.

### Workstream 2 -- Mesh signal-discipline contract
- Scope: tighten peer outputs around calibrated, decision-changing findings: grounded
  evidence, contradiction checks, role/channel discipline, and explicit
  `audit-uncertain` when evidence is insufficient.
- First step: audit `team_dispatch_guard.py`, `review_brief.py`, ask-peer routing,
  and team-channel writes for any remaining path that can create context bloat,
  bypass channels, or inflate weak findings.
- Guardrail: do not rebuild capsules, coverage maps, scoring/eval demos, or any
  duplicate tracker. Refinement must remove dead weight or make existing contracts
  enforceable.

### Workstream 3 -- HME self-coherence suite expansion
- Scope: after Workstreams 1-2, use the refined mesh on HME self-coherence surfaces:
  verifier modules, verifier registry, skip/waiver policy, runtime-warning handling,
  and self-coverage tests.
- First step: select one HME coherence-suite slice and run the mesh for P0/P1 gaps
  that would make HCI misleading, stale, noisy, or fail-open.
- Guardrail: every accepted finding must land as a verifier/test/registry fix using
  the existing `tools/HME/scripts/verify_coherence/` and `tools/HME/tests/specs/`
  structure; no new reporting suite unless an existing verifier cannot express it.

### Workstream 4 -- Execute through existing ledgers only
- Scope: `plan.md` holds user-decision status; TODO holds approved work items;
  team messages stay in team channels; review-brief data stays beside the runner.
- First step after approval: add TODO items for the mesh-refinement contract and the
  first HME self-coherence-suite slice.
- Guardrail: no docs spillover, no process-cleanup project, no self-referential tool
  growth unless it directly increases coherence signal and reduces future bloat.

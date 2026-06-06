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

## Phase 14 (proposed) -- TBD

Status: `proposed` (drafting). Reset after Phase 13 closed; building the next-phase
plan from a mesh consult (red/blue propose divergent directions, purple synthesizes).
Lands here as `proposed` for the user's decision before any implementation.

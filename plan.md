# Plan

Driver (orchestrator) + peers confer; durable, user-approvable proposals land
here. Nothing in this file is implemented until the user marks it approved.

## Status legend
- proposed: drafted from conferral, awaiting user decision
- approved: user approved; safe to implement
- denied: user rejected; do not implement
- done: implemented + verified

## History
- Phases 1-12 (archived in git history): coherence organs/policy/immune fixes,
  the I1-I3 comms substrate, and the fork/full-tool red/blue/purple mesh build-out
  (iterations 6-12) that hardened ask-peer, the dispatch guard, team_agent_router,
  the review harness, proxy filter_tools middleware, and the event-kernel host
  entry/adapters. See `git log -- plan.md` for the full record.

## Phase 13 (APPROVED) -- myth0s: calibrated-audit integration + scale-out

Status: `approved` by user + CEO. Safe to implement. This phase folds the
discovered "Audit Protocol" (the anti-inflation claim-audit grammar) into the
mesh and continues the scale-out trajectory from the program update.

### Theme
Make the mesh's verdicts trustworthy enough to act on at scale. The mesh already
preserves context, grounds reviews in per-surface briefs (composed from data and
sent as channel messages with live source inlined at dispatch -- never committed
capsule files), and routes peers through hard guardrails. This phase adds the
missing calibrated-honesty layer and broadens coverage, evaluation, cost control,
and governance integration -- without ever neutering peer context or tools.

### Cost-control charter (CEO directive -- binding on Workstream D and all budgets)
Cost controls exist ONLY to improve output quality and to prevent runaway /
incoherent agents. They must NEVER abridge an agent's work when it is reasonable
for it to go in depth. Inter-agent communication is sometimes necessary --
including multi-turn back-and-forth -- and budgets must NOT abridge that synergy.
Concretely: caps/budgets target runaway loops and incoherence, not legitimate
depth; any budget that would truncate reasonable depth or needed peer dialogue is
a bug, not a feature. A4 (decision-impact weight) and A5 (anti-inflation) likewise
must never be used to suppress legitimate deep work -- only to focus and calibrate.

### Workstream A -- Audit Protocol integration (calibrated honesty)
Port the GRAMMAR of the Audit Protocol, not its literature-specific scoring.
- A1 [approved]: Reviewer-charter + capsule "claim-audit addendum". For each
  decision-changing finding, require a structured record: claim, affected
  artifact/function, failure mode, precondition, supporting evidence,
  contradictory evidence, one-line fix, severity, confidence. Applied to
  high-impact Context Capsules only -- routine reviews stay lightweight.
- A2 [approved]: Contradictory-evidence requirement. Every claimed defect must
  cite at least one existing guard/test/code path that might already cover it,
  and say why it does or does not. Highest-leverage false-positive reducer.
- A3 [approved]: Audit-thoroughness score, separate from severity:
  source-read-only / source+adjacent-tests-config / source+runtime-repro-or-
  invariant. Lets us distinguish a plausible P1 from a proven one.
- A4 [approved]: Decision-impact weight per finding (load-bearing / substantive /
  peripheral) so peer budget is spent on load-bearing issues, not cosmetics.
  Never used to suppress legitimate deep work -- only to focus it (see charter).
- A5 [approved]: Anti-inflation calibration with a safety caveat. When uncertain
  between two severities, default LOWER -- UNLESS there is executable evidence or
  a fail-open safety consequence, in which case still fail closed.
- A6 [approved]: Finding-death framing. A peer that reports "no decision-changing
  issue found, with evidence" has SUCCEEDED. Encode this in the charter so a
  clean audit is a win, not a gap to fill.
- A7 [approved]: Cross-family/role disagreement as an uncertainty signal. For
  high-impact architectural/security claims, red/blue/purple divergence beyond
  one severity tier emits an explicit "audit-uncertain: recommend human review"
  artifact instead of forcing consensus.
- Explicit non-goals (rejected on study): do NOT import the novelty-tier calculus
  (translate to component-validity / systemic-impact / failure-reach /
  remediation-confidence instead); do NOT run full prior-art search on routine
  reviews (tier-trigger it); do NOT treat the protocol's bibliography as
  canonical until each citation is sourced.

### Workstream B -- Broaden target coverage
- B1 [approved]: Point the fork/full-tool mesh, under the same sequential,
  capsule-grounded discipline, at fresh load-bearing surfaces: pre-write gates,
  state registry, stop-chain policy, session-state lifecycle, transcript
  compaction, proxy request mutation, and tool-result semantics.
- B2 [approved]: Build a reviewed map of every place an agent can mutate state,
  consume context, or enforce policy, so coverage is tracked rather than ad hoc.

### Workstream C -- Formal evaluation harness
- C1 [done; tool retired, lesson kept]: The baseline-vs-mesh scorer
  (score_round.py) demonstrated the lesson once -- baseline 6 findings vs mesh 25,
  ~8 unique-in-mesh -- recorded in the pilot/TODO archive + git. The scorer used a
  token-overlap heuristic (not ground truth) and nothing wired it into the live
  flow, so it was retired as shelf-ware; it is cheaply regenerable if a real
  re-benchmark need arises.
- C2 [retired, lesson kept]: The CLAIM_AUDIT=0-vs-1 A/B harness (eval_harness.sh)
  was never run as a recorded experiment; the calibration value (A1-A7 reduces
  inflation without hiding catches) is held qualitatively from the B1 sweep and is
  in production. Unrun harness retired rather than kept as shelf-ware.

### Workstream D -- Cost controls that improve quality, never abridge depth
Governed by the Cost-control charter above. Caps target runaway/incoherence only.
- D1 [approved; target-selection/cache tooling retired]: The standalone
  select_target/coverage-map/capsule-cache demonstrators were never wired into the
  live mesh and duplicated first-class systems (review status = the TODO ledger;
  surface inventory = review-briefs.json), so they were retired. Review work lives
  in the ONE work tracker (doc/templates/TODO.md); the round runner takes the
  surface/brief directly. The charter (focus effort, never truncate exploration)
  stays binding on the runners themselves.
- D2 [approved]: Adaptive effort levels and per-finding cost telemetry, keeping
  dispatch sequential and bounded against runaway loops -- with explicit headroom
  so reasonable in-depth work and necessary multi-turn peer dialogue are never
  cut short. Telemetry observes cost; it does not cap legitimate depth.

### Workstream E -- Productize review briefs
- E1 [approved; reworked]: Per-surface review briefs are DATA
  (`teams/rounds/review-briefs.json`), composed + linted by `review_brief.py` and
  SENT as channel messages with live source inlined fresh at dispatch -- never
  committed capsule files (the old `teams/capsules/*.md` circumvented both the
  channels and the limited-.md-files invariant; deleted). The coverage<->evidence
  consistency check runs against live source (a freshness gate). The claim-audit
  addendum stays an optional high-impact mode.

### Workstream F -- Policy and governance integration
- F1 [decided: auditability via TODO, enforcement declined]: Enforcement (live
  gates consulting review status) was DECLINED with recorded reasons (would
  fail-closed on legit work or be theater; review status is point-in-time). The
  separate coverage_status "auditability signal" was retired as a TODO-duplicate
  (review progress = TODO progress); review coverage is tracked in the work
  tracker + git history, not a parallel ledger.

### Workstream G -- Internal supervised pilot
- G1 [approved]: Run myth0s against selected internal engineering surfaces under
  human supervision. Success criteria: measurable unique defect discovery, low
  false-positive burden, stable cost envelope, calibrated dissent surfaced, and
  zero policy-bypass regressions.

### Sequencing
1. A1-A6 first (low cost, high leverage; charter + high-impact capsule template).
2. B1 in parallel (continue proving value on fresh surfaces with the new grammar).
3. C1-C2 to make ROI legible before scaling spend.
4. D, E, F as the mesh's verdicts become trustworthy enough to lean on.
5. G as the capstone milestone gating broader internal rollout.

### Acceptance / review notes
- Approved by user + CEO with the Cost-control charter added per CEO directive.
- Standing constraints carry forward: peers are driver FORKS with FULL context and
  FULL tools; dispatch stays sequential; tool filtering stays centralized at the
  proxy; honor every hook/guard at its intent; no context-burn ceremony added to
  routine reviews.

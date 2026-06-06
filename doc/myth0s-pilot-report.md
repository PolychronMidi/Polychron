# myth0s Supervised Pilot Report (Workstream G1)

This is the first supervised internal pilot of the myth0s mesh. The pilot target
was HME's own load-bearing control plane (the B1 sweep): the fork/full-tool,
sequential, capsule-grounded, calibrated claim-audit mesh was pointed at seven
load-bearing surfaces under human supervision. Each round was scored
(teams/rounds/score_round.py); grounded findings were applied in place;
deferred/uncertain items were captured as TODOs. This report measures the pilot
against the G1 success criteria.

## Pilot scope
Surfaces reviewed (all mesh-reviewed; see doc/myth0s-coverage-map.md):
pre-write gate, state registry, stop-chain policy, session-state lifecycle,
transcript compaction, proxy request mutation, tool-result semantics.

## Success criteria -- measured

### 1. Measurable unique defect discovery -- MET
The mesh found decision-changing defects a single baseline reviewer missed.
Per-round unique-in-mesh (score_round heuristic): pre-write 8, state-registry 6,
stop-chain 8, session-state 13, transcript 4, proxy-mutation 8, tool-result 7.
~10 grounded P1s were fixed in place across 6 files, including a real fail-open
SECURITY P1 (proxy request mutation: an early sanitize whose result was discarded
could let an un-sanitized/secret-bearing body reach the wire) that the baseline
did not surface as the top issue. Each fix shipped with a regression test where
the harness allowed it.

### 2. Low false-positive burden -- MET
The calibrated claim-audit discipline visibly suppressed inflation:
- tool-result semantics was a genuine CLEAN AUDIT -- the mesh reported "no
  decision-changing issue, with evidence" and did NOT invent findings.
- cross-exams ran explicit false-positive checks and DEMOTED over-claims, e.g.
  sharpening a claimed in-process corruption down to a precise cross-process
  lost-update, and holding helper-contract concerns at P2 instead of inflating
  them to P1 (the capsule scoped those helpers as assumed-correct).
- the contradictory-evidence requirement forced each finding to name an existing
  guard/test/path that might already cover it (or "none found after checking").

### 3. Stable cost envelope -- MET
Dispatch stayed strictly sequential (no fan-out -> no provider overload). Each
round ran under a bounded leash (240s per peer here). Cost is observed, never
capped, by teams/rounds/cost_telemetry.py (charter-bound: floors only). One round
(proxy mutation) hit the leash on its final cross-exam arm; the other three arms
still converged, so the bounded envelope degraded gracefully without losing the
finding.

### 4. Calibrated dissent surfaced -- MET
The mesh emitted explicit AUDIT-UNCERTAIN artifacts on reachability-uncertain
findings instead of forcing agreement: the stop-chain _hme_subagent escape and
cascade-break Case 2 (provenance/fixture audits needed), the session-state
cross-process lost-update (multi-writer topology unconfirmed), and the transcript
TOCTOU. These are captured as TODOs #17-#21 for human-in-the-loop follow-up rather
than silently applied or dropped.

### 5. Zero policy-bypass regressions -- MET
Every fix HARDENED a gate; none weakened one. After the sweep the full coherence
index held at HCI ~99 with env-no-fallback, silent-failure-class, atomic-state-
writes, state-file-ownership, markdown-invariant, shell-undefined-vars,
proxy-middleware-registry, and dispatcher-route-contract all PASS, and the affected
test suites (team substrate, state_registry, stop_chain, pre-write/session-state,
transcript_compactor, proxy extracted modules, tool-result marker) all green.

## Honest limits
- The pilot reviewed HME's OWN control plane, not another team's codebase; a
  broader cross-team pilot is the next-phase extension.
- The unique-in-mesh count is a token-overlap heuristic, not semantic ground truth.
- Several confirmed-but-reachability-uncertain items were deferred (TODOs #17-#21)
  rather than fixed in place -- by design, to avoid rushing risky changes.

## Conclusion
On its own control plane, myth0s met all five G1 success criteria: it found real,
unique, decision-changing defects (including a security fail-open), kept a low
false-positive burden via calibrated honesty, held a stable bounded cost envelope,
surfaced calibrated dissent for human review, and introduced zero policy-bypass
regressions. The mesh is ready for a broader, still-supervised internal pilot.

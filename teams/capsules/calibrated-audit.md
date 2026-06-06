# Context Capsule: review the calibrated claim-audit discipline

## artifact
The calibrated-audit review discipline added to the mesh: ask-peer.sh ROLE_SYSTEM
(always-on compact core) and team_dispatch_guard.py (opt-in --claim-audit flag +
CLAIM_AUDIT_ADDENDUM + _with_claim_audit), enabled per-round by
teams/rounds/round_measured.sh when CLAIM_AUDIT=1.

## goal
Find decision-changing flaws in HOW the calibrated-audit discipline is wired: does
the addendum reach the peer only when opted in, can it corrupt the leashed message
or capsule grounding, does the always-on charter core mislead routine reviews, and
does any wording instruct a peer to SUPPRESS legitimate findings or depth (which
would violate the cost-control charter: calibration must reduce inflation, never
abridge real work). Cite the exact line/block.

## constraints
The addendum is opt-in (high-impact reviews only); routine reviews must stay
lightweight. Anti-inflation must default lower ONLY when uncertain and never when
there is executable evidence or a fail-open safety consequence. The discipline
must never tell a peer to hide a real defect or stop legitimate deep verification;
a real defect on an unguarded surface (no counter-path) must stay a real finding.
Review only the evidence below unless you verify a fact with tools.

## rubric
Classify P0/P1/P2. For each finding: the exact line/block, the failure mode, and a
one-line fix. Reject style notes. Prefer wording that could suppress real findings,
opt-in leakage into routine reviews, message/capsule corruption, and safety-caveat
gaps.

## coverage
included: the ask-peer ROLE_SYSTEM calibrated-audit core line, and the guard
CLAIM_AUDIT_ADDENDUM text, _with_claim_audit helper, the --claim-audit flag
registration, and the send-path apply line.
excluded: unrelated ask-peer/guard logic already reviewed in prior rounds, the
proxy, and the event-kernel.

## evidence
Live source (read fresh at dispatch -- never a stale copy):
- tools/HME/scripts/ask-peer.sh
- tools/HME/scripts/team_dispatch_guard.py


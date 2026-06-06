# Context Capsule: review the session-state store

## artifact
tools/HME/proxy/session_state.js -- the per-session state store. readState/
writeState/update do a read-modify-write of runtime/session-state.json (with a
legacy mirror); normalize fills defaults and coerces array/object shapes;
recordPhase/recordWrite/recordRead/recordDetectorOutcome/recordVerificationEvidence
append bounded entries; recentVerificationEvidence filters by age.

## goal
Find decision-changing correctness/safety flaws: a write that can corrupt or lose
durable session state, a lost-update race in the read-modify-write `update`, a
durability gap (crash between write and rename, or no fsync), a normalize bypass
that persists wrong-shaped state, or a mirror write that can diverge. Cite the
function + line.

## constraints
readState throws (fails closed) on a corrupt non-ENOENT file -- that is
intentional, not a bug, unless you show it wedges a caller that should degrade.
The bounded arrays cap memory by design. The legacy mirror is best-effort. Review
only the evidence below unless you verify a fact with tools.

## rubric
Classify P0/P1/P2 with the claim-audit discipline. For each: function/line, exact
failure, contradictory evidence (which existing check/test may already cover it,
or "none found after checking"), and a one-line fix. Reject style notes. Prefer
read-modify-write races, durability (fsync/rename), and normalize/shape bugs.

## coverage
included: full session_state.js source below -- defaultState, normalize, readState,
writeState, update, _pushBounded, recordPhase, recordWrite, recordRead,
recordDetectorOutcome, recordVerificationEvidence, and recentVerificationEvidence.
excluded: the callers of these functions and the shared RUNTIME_DIR/PROJECT_ROOT
module (assumed correct here).

## evidence
Live source (read fresh at dispatch -- never a stale copy):
- tools/HME/proxy/session_state.js


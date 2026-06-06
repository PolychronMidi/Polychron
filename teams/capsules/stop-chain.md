# Context Capsule: review the stop-chain evaluator

## artifact
tools/HME/proxy/stop_chain/index.js -- the Stop-hook policy evaluator. runStopChain
runs an ordered policy list with first-deny-wins aggregation: mandatory policies
(detectors, anti_patterns, work_checks) fail CLOSED (deny) on load/throw; optional
policies fail OPEN (allow) so diagnostics can't wedge the chain. It also has a
subagent escape, a cascade-break short-circuit, strict-only policy gating, unified-
registry disable, hot-reload of policy modules, trace, and a one-event-per-run
coherence ledger append.

## goal
Find decision-changing correctness/safety flaws: a path that lets a turn STOP when
a mandatory policy should have blocked it, a cascade-break/subagent escape that is
too broad (silences real denies), a first-deny aggregation bug, a hot-reload cache
bug, or an unbounded/again-throwing failure path. Cite the function + line.

## constraints
Mandatory policies MUST fail closed; optional policies MUST fail open (intentional,
not a bug, unless you show a mandatory check is skipped). The Stop protocol's only
user-visible channel is block-with-reason, so instruct messages fold into a block.
Trace/telemetry/ledger writes are advisory and must never wedge the chain. Review
only the evidence below unless you verify a fact with tools.

## rubric
Classify P0/P1/P2 with the claim-audit discipline. For each: function/line, exact
failure, contradictory evidence (which existing check/test may already cover it, or
"none found after checking"), and a one-line fix. Reject style notes. Prefer
escape-too-broad, mandatory-skip, aggregation, and fail-open/closed scope bugs.

## coverage
included: full stop_chain/index.js source below -- _loadUnifiedConfig,
_isPolicyEnabled, _policyNamesForMode, mandatoryPolicyFailure, appendTrace,
resetTrace, logError, loadPolicy, _isCascadeBreakConditions, runStopChain, and the
first-deny aggregation loop.
excluded: the individual policy modules under stop_chain/policies/, the telemetry
module, and coherence_events (assumed correct here).

## evidence
Live source (read fresh at dispatch -- never a stale copy):
- tools/HME/proxy/stop_chain/index.js


# Context Capsule: review the pre-write gate (preWriteCheck)

## artifact
tools/HME/proxy/pre_write_check.js -- the load-bearing PreToolUse write gate.
preWriteCheck orchestrates, in order: applyPatchDecision, _editShapeDecision,
todoWriteDecision, the JS policy chain (firstDeny/rewrites/errors), then
_shellParityDecision, _editCurrentFileDecision, and _kbBugfixDecision, with a
fail-open catch. _repeatDeny escalates repeated identical denies; toHookResponse
renders the host decision.

## goal
Find decision-changing correctness/safety flaws in the gate: an ordering that lets
a dangerous write slip the hard checks, a fail-open path that swallows a real deny,
a rewrite that is applied without re-validation, a _repeatDeny state write that can
corrupt, or a credential/secret pattern that can be bypassed. Cite the function +
line. Per the cost-control charter, do NOT propose changes that merely add latency
without improving safety/quality.

## constraints
This gate runs on every write-family tool call and must fail OPEN on policy/state
outages (basic editing must not break) AFTER the hard-deny checks have run -- that
fail-open is intentional, not a bug, unless you can show a hard check is skipped.
Hard denies (shape, patch, shell-parity, edit-current, credential) must run before
any allow. Review only the evidence below unless you verify a fact with tools.

## rubric
Classify P0/P1/P2 with the claim-audit discipline. For each: function/line, exact
failure, contradictory evidence (which existing check/test may already cover it, or
"none found after checking"), and a one-line fix. Reject style notes. Prefer
ordering/bypass, fail-open scope, rewrite re-validation, and state-write safety.

## coverage
included: full pre_write_check.js source below -- preWriteCheck, applyPatchDecision
use, _editShapeDecision, todoWriteDecision use, _shellParityDecision,
_editCurrentFileDecision, _kbBugfixDecision, _repeatDeny, _permission,
_runTddGate, _backgroundWarningDecision, and toHookResponse.
excluded: the imported modules' internals (edit_validation, apply_patch_gate,
todo_invariant_guard, policies registry) except where called here; the event-kernel
dispatcher that invokes this gate.

## evidence
Live source (read fresh at dispatch -- never a stale copy):
- tools/HME/proxy/pre_write_check.js


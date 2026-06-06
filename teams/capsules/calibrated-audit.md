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
ask-peer.sh ROLE_SYSTEM calibrated-audit core
```
ROLE_SYSTEM="$ROLE_SYSTEM You are a forked peer with the driver's full inherited context. Answer only in the requested team role; do not continue driver narration or echo the handoff. You are a REVIEWER: report each finding as text (cite the section + a one-line fix); verify read-only with tools as needed. Do NOT request write/tool permission or wait for approval -- just deliver findings. Calibrated audit (anti-inflation): a clean audit is a SUCCESS -- if after completing the requested checks you find no decision-changing issue, say so with evidence and never invent or inflate (do not use this to skip deep verification or drop a real finding). For each real finding cite supporting evidence AND any existing guard/test/code-path you checked that might already cover it (say why it does not), OR state 'none found after checking'; absence of a counter-check does not by itself lower confidence -- a real defect on an unguarded surface stays real. When unsure between two severities pick the LOWER unless there is executable evidence or a fail-open safety risk. Be terse and decision-changing."
```

team_dispatch_guard.py CLAIM_AUDIT_ADDENDUM + _with_claim_audit
```python
CLAIM_AUDIT_ADDENDUM = (
    "\n\n---\nCLAIM-AUDIT DISCIPLINE (calibrated, anti-inflation). For EACH "
    "decision-changing finding report: claim (one sentence); where (artifact + "
    "function/block); failure mode; precondition; supporting evidence (cite "
    "source lines / tests / logs / verifier output); contradictory evidence "
    "(cite any plausible existing guard/test/code-path you checked and why it "
    "does or does NOT cover this, OR state 'none found after checking <paths>'. "
    "Absence of a plausible counter-check does NOT lower confidence by itself -- "
    "only an UNCHECKED plausible counter-path does. A real defect on an unguarded "
    "surface stays a real defect); one-line fix; severity (P0/P1/P2); "
    "thoroughness (read-only | +adjacent-tests/config | +runtime-repro/invariant); "
    "decision-impact (load-bearing | substantive | peripheral); confidence "
    "(low/med/high).\nFINDING-DEATH IS SUCCESS: if after completing the requested "
    "checks you find no decision-changing issue, state 'no decision-changing issue "
    "found' WITH evidence -- never invent or inflate to seem useful, and never use "
    "this to avoid deep verification or to drop a legitimate finding.\n"
    "ANTI-INFLATION: when unsure between two severities choose the LOWER, UNLESS "
    "there is executable evidence or a fail-open safety consequence (then keep the "
    "higher / fail closed).\nAUDIT-UNCERTAIN: if you materially disagree with a "
    "prior peer beyond one severity tier on a load-bearing claim, label it "
    "'AUDIT-UNCERTAIN: recommend human review' instead of forcing agreement."
)


def _with_claim_audit(message: str, enabled: bool) -> str:
    return message + CLAIM_AUDIT_ADDENDUM if enabled else message
```

team_dispatch_guard.py --claim-audit flag + send-path apply
```python
p.add_argument("--claim-audit", action="store_true", help="append the calibrated claim-audit addendum (structured finding record + mandatory contradictory-evidence + anti-inflation + finding-death + audit-uncertain). Opt-in for high-impact reviews; routine reviews stay lightweight.")
message = _with_claim_audit(message, args.claim_audit)
```

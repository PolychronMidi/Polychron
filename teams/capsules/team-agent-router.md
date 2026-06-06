# Context Capsule: review team_agent_router.py

## artifact
tools/HME/scripts/team_agent_router.py -- routes a requested tier/caller to a
team role before team_dispatch_guard.py and ask-peer.sh deliver the handoff.

## goal
Find decision-changing correctness/security flaws in routing that would make the
fork/full-tool mesh dispatch the wrong peer, silently under-route, or hide routing
failure. Cite functions/blocks.

## constraints
Team policy: peers are driver forks with full inherited context and full tool
access; tool filtering is centralized via HME_FILTER_TOOLS_DROP. Dispatch must be
sequential/no fan-out. The router must be conservative: wrong-peer routing is
worse than explicit denial.

## rubric
Classify P0/P1/P2. For each: exact function/block, failure, and one-line fix.
Reject style notes. Prefer fail-open, spoofing, tier/order, and stale-state bugs.

## coverage
included: full router source below -- registry load, tier parsing,
role filtering/selection, diagnostics, and main CLI behavior.
excluded: ask-peer.sh and team_dispatch_guard.py (assume current and correct).

## evidence
Live source (read fresh at dispatch -- never a stale copy):
- tools/HME/scripts/team_agent_router.py


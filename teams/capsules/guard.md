# Context Capsule: review team_dispatch_guard.py

## artifact
tools/HME/scripts/team_dispatch_guard.py -- the leashed dispatch guard between
the team router and ask-peer.sh. Enforces depth cap, per-turn budget (flock
reserve+refund), crew gate, leash, global concurrency bound, killpg-on-timeout,
context/capsule grounding, and driver-session propagation for forked peers.

## goal
Find DECISION-CHANGING security/correctness flaws that survive the current
hardening. Only issues that change what we should ship. Cite the function.

## constraints
Usage model today: single-driver, pull-only, sequential dispatch (NOT concurrent
fan-out). Peers are driver forks with full inherited context and full tool access;
if any tool filtering is wanted it is centralized at the proxy via
HME_FILTER_TOOLS_DROP. The guard is the ONLY path from router to peer.

## rubric
Classify each finding P0 (ship-blocker) / P1 (should-fix) / P2 (nice). For each:
name the function, the exact failure, and the one-line fix. Reject vague style notes.

## coverage
included: the full guard source below (reserve/refund/flock, _send/killpg,
_infer_depth, _effective_tier, _load_budget, _load_capsule, _capsule_headings,
_capsule_coverage_gaps, main flow).
excluded: ask-peer.sh, team_agent_router.py (assume correct for this review).

## evidence
Live source (read fresh at dispatch -- never a stale copy):
- tools/HME/scripts/team_dispatch_guard.py


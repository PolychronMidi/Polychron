# Context Capsule: review round_measured.sh (the mesh review harness)

## artifact
teams/rounds/round_measured.sh -- the sequential, capsule-grounded review-round
runner: snapshots/restores the team dashboard, resets channels + per-role
sessions + dispatch budget, and dispatches BASELINE (one peer) then a MULTI-PEER
chain (red_lead -> red_purple -> blue_purple) through team_dispatch_guard.py.

## goal
Find decision-changing correctness/safety flaws in the HARNESS that would corrupt
results, leak state across runs, mis-restore the dashboard, or mis-bound the
round. Cite the block. ask-peer.sh and the guard are assumed correct here.

## constraints
Team policy: peers are driver forks with full inherited context and full tool
access; dispatch is strictly sequential (no fan-out). The harness writes only
under teams/ and tools/HME/runtime; it must leave the dashboard as it found it.
bash is set -uo pipefail (note: not -e). PROJECT_ROOT is required.

## rubric
Classify P0/P1/P2. For each: block, exact failure, one-line fix. Reject style
notes. Prefer state-leak, trap/cleanup, quoting, and race/ordering bugs.

## coverage
included: the full harness source below -- PROJECT_ROOT handling, DASH
snapshot/restore trap, channel/session/budget reset, the gcap guard wrapper,
reply extraction, and the baseline + multi-peer dispatch sequence.
excluded: ask-peer.sh, team_dispatch_guard.py, team_agent_router.py.

## evidence
Live source (read fresh at dispatch -- never a stale copy):
- teams/rounds/round_measured.sh


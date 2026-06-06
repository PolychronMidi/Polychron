# Context Capsule: review ask-peer.sh (the team comms primitive)

## artifact
tools/HME/scripts/ask-peer.sh -- the single comms primitive every team member
uses. Looks up a role in teams/roles.json, validates it, appends the caller turn
to the role's channel (real-newline, structural-tag-neutralized, turn-atomic
tail-capped, flock-serialized), forks the driver session (or, opt-in, resumes the
role thread), stream-caps raw stdout via a FIFO capper, parses reply/session, and
appends peer turn or explicit peer-error.

## goal
Find DECISION-CHANGING security/correctness flaws that survive the current
hardening. Only issues that change what we ship. Cite the function/block. The
guard (team_dispatch_guard.py) is assumed correct; review ask-peer.sh itself.

## constraints
Usage model: single-driver, pull-only, sequential dispatch (NOT concurrent
fan-out). Non-driver callers must arrive via the guard (HME_TEAM_DISPATCH_GUARD_OK=1).
Only forked peers are allowed; default re-forks the driver, HME_TEAM_RESUME_PEER_SESSIONS=1
opts into per-role memory. Peers have full inherited context and full tool access;
any tool filtering is centralized at the proxy via HME_FILTER_TOOLS_DROP, not
ask-peer. bash is set -euo pipefail. jq + python3 available.

## rubric
Classify each finding P0 (ship-blocker) / P1 (should-fix) / P2 (nice). For each:
name the function/block, the exact failure, and the one-line fix. Reject vague
style notes. Prefer injection/escaping, race, fail-open, and quota-evasion flaws.

## coverage
included: the full ask-peer.sh source below -- arg parsing, role lookup +
validation, tier-drift check, non-driver dispatch block, FORCE_FAIL/FORCE_HANG,
ROLE_SYSTEM charter, valid_sid, resolve_driver_sid, cap_channel, append_exchange,
peer launch MODE, FIFO stream raw cap, robust JSON parse, SID persistence, and
reply byte-cap.
excluded: team_dispatch_guard.py, teams/roles.json contents, host_hook_entry.js
(assume correct for this review).

## evidence
Live source (read fresh at dispatch -- never a stale copy):
- tools/HME/scripts/ask-peer.sh


# Plan

Driver (orchestrator) + peers confer; durable, user-approvable proposals land
here. Nothing in this file is implemented until the user marks it approved.

## Status legend
- proposed: drafted from conferral, awaiting user decision
- approved: user approved; safe to implement
- denied: user rejected; do not implement
- done: implemented + verified

## History
- Phase 1-2 (archived): coherence organs + policy/immune honesty fixes. Green.
- Phase 3 substrate (shipped): I1 comms substrate (teams/roles.json + ask-peer.sh,
  chat.md -> teams/driver.md, tail-capped channels) and I2 leash/dispatch gate
  (team_dispatch_guard.py: depth cap, per-turn budget, crew gate, per-call leash).
  Unit-tested. I3 role entries (red/blue/purple + crew) were added to roles.json.
- Phase 3 I3 value trial: INVALID. The trial routed against teams/red.md,
  teams/blue.md, teams/purple.md which DO NOT EXIST as files, and scored a
  failed route ("no_target") as if it were a result. It proved nothing about
  whether the mesh adds value. I3 stays UNPROVEN, not dormant-by-evidence.

## Proposals (Phase 4 -- prove-or-retire the I3 mesh; awaiting human approve/deny)

(to be filled from conferral)

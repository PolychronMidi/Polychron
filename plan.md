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

Framing (Agent2, skeptic): 3 phases produced single-peer signal, 0 VALID mesh
signal. Bias strongly toward RETIRE. Give the mesh exactly ONE fair, best-case
run; if it doesn't clearly win on catch-per-cost, delete the role entries +
channel files. "Keep, unused" = dead weight = retire. Do not run a 2nd trial.

### P1 -- Make a trial physically valid before it can score  [approved]
- seam: seed the three real channel files (teams/red.md, teams/blue.md,
  teams/purple.md) with a header line so they exist + are tail-cap targets;
  register the roles the round touches in team-dashboard.json (red_lead,
  red_purple, blue_lead, blue_purple as status=registered with tier/ctx) so the
  router selects real entries instead of returning no_target.
- hard rule: a no_target / failed route ABORTS the trial -- it is never scored
  as a result (the exact bug that made the last trial invalid).
- NOT this: no new code; no broadcast; no extra roles beyond the four the round needs.

### P2 -- One real task, both paths, comparable  [proposed]
- task: a single ADVERSARIAL REVIEW of one real code artifact the single peer has
  ALREADY reviewed (known-quality baseline). Identical prompt, "return only
  decision-changing flaws."
- baseline: Driver <-> one peer, 1 round.
- mesh: Driver -> red_lead -> (purple handoff) -> blue rebuttal, 1 round, same
  artifact, same wall budget (<=4 calls/path).

### P3 -- Exact measured comparison + binary kill criterion  [proposed]
- signal: count DISTINCT decision-changing catches each path makes that the OTHER
  missed (unique real catches; discard dupes/style).
- cost: total peer calls, total in+out bytes, channel-line growth.
- decider: unique-real-catches per call and per byte. Mesh must beat baseline on
  catch-per-COST, not raw count.
- RETIRE (delete red/blue/purple role entries + channel files; keep only the I1
  single-peer substrate + I2 guard): mesh surfaces 0 unique catches the peer
  missed, OR catch-per-cost worse than baseline.
- KEEP: mesh surfaces >=1 real flaw the single peer missed AND cost <=~2x baseline.

### Hard NOT-this (so the trial itself can't become noise)
- 1 round, 1 task, 1 run. No multi-round back-and-forth, no reruns, no purple
  chatter beyond the single red->purple->blue handoff. Channels tail-capped.
- If setup+run exceeds ~1 session of effort, ABORT -> retire.

## Decision
Recommend: run P1+P2+P3 as ONE bounded trial, then act on the binary result
immediately (KEEP or RETIRE, no dormant middle). Awaiting human approve/deny.

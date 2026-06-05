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
- Phase 4 FULL red/blue/purple mesh (DONE + working, per human direction):
  full 12-role teams/roles.json (red/blue leads, red/blue purples, crew E4-E1) +
  real channel files teams/{red,blue,purple}.md. One full round completed
  (abort:none): driver->red_lead->red_purple (red.md intra), driver->blue_lead->
  blue_purple (blue.md intra), red_purple->blue_purple (purple.md inter-team).
  Channels hold real, context-aware adversarial content for audit.
- Two corrections that made it actually work (my earlier calls were WRONG):
  1. FORK-OF-DRIVER: peers were minting fresh context-BLANK sessions (returned
     8-byte junk -> the "mesh has no value / retire" read was an artifact of
     crippled peers, NOT the mesh idea). Fix: ask-peer forks the driver session
     (--resume <driver_sid> --fork-session); guard propagates HME_DRIVER_SESSION_ID.
  2. TOOLS-DISALLOWED: a forked peer inherits the driver's tools and re-explores
     (long Read loops, 10+ min) -- that was the "slowness", NOT transcript size
     (a fabricated theory; 300-485K-token calls return in <20s). Fix: peers are
     reviewers that answer from inherited context with --disallowedTools; a real
     forked review now returns in ~20s.
- Demonstrated mesh VALUE (this round, not theory): red sharpened to a P0 trio;
  blue triaged/demoted the race, promoted reserve-burns-on-failure as today's
  bug, and ADDED catches red missed (corrupt-mid-write fail-open compound; no
  global concurrency bound); purple cross-team synthesis named the unique catches
  "surfaced only through red-push/blue-defend adversarial exchange" (reserve-burns
  -on-fail + global-concurrency-bound). That is real adversarial signal a single
  peer would likely miss.

## Real guard bugs the mesh surfaced (in team_dispatch_guard.py; fix candidates)
- F-A [proposed]: budget reserve burns quota on FAILED/timed-out route (debit
  before send succeeds, no rollback) -- consensus #1, behavior-changing. Commit-
  on-success / refund on abort.
- F-B [proposed]: flock + fsync the budget read-modify-write (atomic reservation);
  closes the concurrent-fan-out race + the corrupt-mid-write fail-open compound.
- F-C [proposed]: one pinned parent token -> depth + caller identity fail-CLOSED
  together (deny when depth/identity unknown for a non-driver; folds the
  HME_TEAM_DEPTH / spoofable --caller holes).
- F-D [proposed]: global concurrency bound (cap distinct live turn_ids), not just
  per-turn budget; validate tier before TIER_ORDER indexing; fail-closed state load.
- Named debt: max_tools is advisory (no runtime killer) -- the runaway leash lesson.

## Meta-cognition (team/task structure)
- A multi-agent mesh is worthless if members start context-blank; the ONE thing
  that makes peers useful is inheriting the driver's full context (fork), then
  constraining them to ANSWER not re-explore. Get those two right before judging
  mesh value -- I judged (retire) on crippled peers and was wrong.
- Adversarial value is real when red and blue actually DISAGREE on a live artifact
  (here: race likelihood) and purple forces a consensus -- that produced catches
  neither a single peer nor a non-adversarial 2nd peer surfaced.

## Decision
Full mesh implemented + working + audited (teams/{red,blue,purple}.md). Next:
human audits the channels; F-A..F-D are real guard fixes awaiting approve/deny.

## Decision
Phase 4 ran and RETIRED the mesh (above). Phase 5 (F-A..F-D) hardens the retained
single-peer substrate; awaiting human approve/deny per fix.

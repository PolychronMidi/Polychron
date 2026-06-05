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

## Guard hardening F-A..F-D (DONE + unit-proven, 8/8 in team_comms_substrate)
- F-A [done]: reserve-then-REFUND. Budget unit is refunded when the gated send
  fails (timeout/error); message validated BEFORE reserve so a malformed --send
  can't burn quota.
- F-B [done]: flock-serialized budget read-modify-write + fsync atomic write
  (closes the concurrent-fan-out race + corrupt-mid-write durability).
- F-C [done]: depth fail-CLOSED (deny when depth unknown for a non-driver, no
  silent default-to-1); optional HME_TEAM_STRICT_IDENTITY rejects a spoofed
  non-driver caller lacking the guard provenance token.
- F-D [done]: global concurrency bound (--max-live distinct turn_ids);
  fail-closed corrupt-state load (existing-but-unparseable budget => deny, not
  fail-open reset); defensive tier validation before TIER_ORDER indexing.
- Named debt (still open): max_tools is advisory (no runtime killer).

## Self-evolution loop (mesh reviewing its own substrate) -- real findings
- The mesh review of F-A..F-D surfaced TWO substrate findings about ITSELF:
  1. FORK-IDENTITY CONTAMINATION: a fork of the driver IS the driver (same model
     + context + identity). On a concrete artifact-review task it plays the role
     straight (the earlier round produced genuine red-vs-blue dissent), but when
     the driver transcript is thick with orchestration narration the fork
     CONTINUES that narration instead of answering as the role -- or recognizes
     the role request as roleplay and declines. Partial mitigation added:
     role-isolation framing in the leashed handoff ("you are <role>, distinct,
     do not continue the driver's narration"). Deeper truth: distinct adversarial
     value wants distinct agents/contexts; fork-of-driver is best for review
     dispatched EARLY in a clean turn, not deep in a meta-heavy transcript.
  2. LIFECYCLE MISFIRE: forked peer sessions fire the full HME hook chain and a
     peer observed UserPromptSubmit before SessionStart on its fork -> forked
     peers trip lifecycle ordering. Open substrate item to fix.
- Honest read: the loop self-evolved (the mesh improved the mesh), but the
  fork-identity limit means the mesh's adversarial value is real for concrete
  early-turn reviews and weak as a generic "team of distinct agents."

## Decision
Mesh fully implemented + working; F-A..F-D fixes landed + unit-proven (8/8);
self-evolve loop produced 2 substrate findings (role-isolation framing applied;
forked-peer lifecycle misfire still open). Channels (teams/{red,blue,purple}.md)
are populated for human audit.

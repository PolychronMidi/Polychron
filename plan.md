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
- Phase 3 I3 value trial: INVALID (twice botched; sandbox detours when real
  channel files were the ask). Cleared.
- Phase 4 prove-or-retire trial (DONE, VALID): real channels seeded, live
  dashboard snapshot+restore (was MISSING pre-trial -> no live state clobbered),
  one adversarial review of team_dispatch_guard.py through both paths.
  - baseline (1 peer, 1 call, 1471B, 51s): 6 decision-changing flaws.
  - mesh (red_lead->red_purple->blue_purple, 3 calls, 1082B, 111s): red_lead 5
    flaws + red_purple confirm/refine; blue_purple reply was "[SUCCESS" (8B junk
    -- the signature red-vs-blue leg produced ZERO signal).
  - score: both paths found ~4-5 unique flaws the other missed (a wash on
    signal); mesh cost 3x calls / ~2.2x wall for the same signal -> catch-per-cost
    WORSE. KEEP needed cost <=~2x AND a unique catch; cost bound failed.
  - VERDICT: RETIRE. Deleted red/blue/purple + crew role entries from roles.json,
    deleted teams/{red,blue,purple}.md + stale per-role sessions. Kept only the
    single-peer loop (blue_lead) + the I1/I2 substrate + guard. The mesh's only
    real value was "a 2nd peer confirms the 1st" -- which the 2-agent loop already
    does, cheaper.

## Meta-cognition (how to evolve task/team structure)
- The whole exercise's best signal came from ONE good peer plus ONE confirming
  peer (a 2-agent loop). Cross-team red-vs-blue dissent never materialized; the
  9-role mesh was structure without a job. Lesson: grow agents only when a
  distinct ROLE has a distinct, measured job -- not by org-chart symmetry.
- Substrate coherence holes the trial exposed (real, in shipped code):
  the router silently degrades to no_target instead of failing loud; a routed
  dispatch to a missing channel/unregistered role should be a LOUD abort.
- The blue_purple "[SUCCESS" 8B reply is a real ask-peer/guard output-extraction
  bug under the leashed-handoff path (reply truncation), not just a model miss.
- Both reviews independently flagged budget RMW non-atomicity + depth fail-OPEN
  as the load-bearing guard flaws -- those are real bugs in code that STAYS.

## Proposals (Phase 5 -- harden the retained single-peer substrate; awaiting approve/deny)
- F-A [proposed]: budget reserve = lock (flock) the read-modify-write of
  team-dispatch-budget.json; both reviews rated this HIGH (cap evadable under
  concurrent dispatch).
- F-B [proposed]: depth guard fail CLOSED -- deny when depth is unknown for a
  non-driver caller (today _infer_depth defaults to 1 -> cascade if env not
  inherited).
- F-C [proposed]: validate request shape + bounded turn-id BEFORE any budget I/O
  (so `--send --message ""` and junk tiers can't burn budget / KeyError-crash);
  schema-check budget state and fail-closed on a non-dict, never traceback.
- F-D [proposed]: fix ask-peer reply extraction so a real peer reply can't be
  truncated to "[SUCCESS"; add a no_target/empty-reply LOUD abort.
- NOT now: do not re-expand the role mesh. These harden the ONE proven loop only.

## Decision
Phase 4 ran and RETIRED the mesh (above). Phase 5 (F-A..F-D) hardens the retained
single-peer substrate; awaiting human approve/deny per fix.

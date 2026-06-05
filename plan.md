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

### P1 -- Make a trial physically valid before it can score  [done]
- seam: seed the three real channel files (teams/red.md, teams/blue.md,
  teams/purple.md) with a header line so they exist + are tail-cap targets;
  register the roles the round touches in team-dashboard.json (red_lead,
  red_purple, blue_lead, blue_purple as status=registered with tier/ctx) so the
  router selects real entries instead of returning no_target.
- hard rule: a no_target / failed route ABORTS the trial -- it is never scored
  as a result (the exact bug that made the last trial invalid).
- NOT this: no new code; no broadcast; no extra roles beyond the four the round needs.

### P2 -- One real task, both paths, comparable  [approved]
- task: a single ADVERSARIAL REVIEW of one real code artifact the single peer has
  ALREADY reviewed (known-quality baseline). Identical prompt, "return only
  decision-changing flaws."
- baseline: Driver <-> one peer, 1 round.
- mesh: Driver -> red_lead -> (purple handoff) -> blue rebuttal, 1 round, same
  artifact, same wall budget (<=4 calls/path).

### P3 -- Exact measured comparison + binary kill criterion  [approved]
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

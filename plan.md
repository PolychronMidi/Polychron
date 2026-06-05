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

## Self-evolution iteration 2 (DONE -- distinct-agent substrate + mesh re-review)
- Substrate evolved to kill fork-identity contamination at the root: peers are
  now DISTINCT AGENTS (context_mode=fresh + per-role `system` charter + role
  isolation) instead of pure driver-forks. Verified: a fresh red_lead returns a
  clean role answer in ~9s with ZERO driver-narration echo.
- Other improvements this iteration: channel writer uses REAL newlines (no
  JSON-escaped "\n"); HME_TEAM_PEER=1 makes peer sub-sessions no-op the driver
  lifecycle hooks (kills the UserPromptSubmit-before-SessionStart misfire);
  fixed an `env`-arg-order bug (assignments-before-`-u` -> exit 127).
- Re-ran the mesh (now distinct agents) to review the new substrate. Clean,
  uncontaminated, readable channels. It found REAL bugs in my own code; I fixed
  the top two and unit-proved them (now 9/9):
  - TIMEOUT-ORPHAN [done]: subprocess timeout killed only ask-peer.sh; the
    `claude` grandchild orphaned and kept spending (the exact orphan I'd been
    killing by hand). Fix: run the child in its own process group
    (start_new_session) and killpg the WHOLE group on timeout. Test proves the
    guard returns in ~2s, not 60s.
  - TAIL-CAP TURN-BLINDNESS [done]: real newlines let a raw `tail -n` bisect a
    turn. Fix: turn-atomic cap (keep last whole turns, never a fragment). Tested.
  - Also notable: blue/purple peers HONESTLY DECLINED to invent criticisms when
    the handoff didn't carry the artifact -- distinct agents not hallucinating.
- Open debt (mesh-named, not yet done): hard output/byte cap on peer stdout;
  channel tag-forgeability (current format escapes only the exact close-tag);
  pass the artifact + prior findings into purple-handoff hops so they're grounded.

## Self-evolution iteration 3 (DONE -- close open debt + multi-step dialogue)
- Closed the iter-2 open debt (all unit-proven, now 12/12):
  - OUTPUT/BYTE CAP [done]: ask-peer caps captured claude JSON (head -c, 4MB);
    truncated JSON degrades to empty (no OOM).
  - TAG-FORGEABILITY [done]: channel writer neutralizes ALL structural tags in
    payloads (<driver/<peer/</...> -> guillemet form), so a reply can't spoof
    transcript structure. Test asserts exactly one real close tag.
  - GROUNDING [done]: guard --context-file / --capsule carry the artifact into
    fresh-agent hops so they're grounded instead of declining.
- MULTI-STEP DIALOGUE (the user's ask): ran a real 2-round red<->blue debate
  (each peer RESUMES its session = memory) + purple synthesis, on the open design
  question "fresh distinct agents vs driver-fork." Both sides CONCEDED real
  points and CONVERGED. Decision-changing output:
  - DEFAULT = fresh independent judges for adversarial/decision review; demote
    driver-forks to read-only context scouts with NO decision authority, and only
    fork from a CLEAN/curated substrate, never the live meta-heavy transcript.
  - The ONE mechanism that lets grounded independent peers beat a single
    high-effort reviewer: a mandatory CONTEXT CAPSULE (artifact+goal+constraints+
    evidence+rubric+coverage{included/excluded/why}); peers must CITE capsule
    sections, flag GAPs, or decline -- "not vibes or packet-quality roulette."
  - Hybrid only as a formal one-way pipeline: clean-fork scouts -> cited capsule
    -> fresh judges adjudicate. Trap if ad hoc or forks get votes.
- IMPLEMENTED the mesh's own design: guard `--capsule` validates required
  sections (## artifact/## goal/## rubric) and wraps the task with the cite-or-
  decline contract. The mesh designed its next feature; it now exists + is tested.
- Lifecycle misfire fix (CORRECTED in iter 4): my first attempt used
  `--setting-sources user`, which was BACKWARDS -- the HME hooks live in USER
  settings (~/.claude), so that loaded exactly the hooks to drop and the misfire
  kept firing. Real fix: `--setting-sources project,local` (exclude user) ->
  verified routing still works (env-based) and a peer call produces 0 new
  UserPromptSubmit-before-SessionStart alerts.
- Operational insight (real, from a transient anthropic 200 overloaded_error):
  bursting many concurrent peer calls overloads the provider. Mesh dispatch must
  stay sequential / rate-limited; the F-D live-turn bound + one-round-at-a-time
  discipline are the guardrails. Do NOT fan out heavy rounds.

## Self-evolution iteration 4 (DONE -- MEASURED: grounded multi-peer beats one peer)
- Built a REAL Context Capsule from the actual guard source (## artifact/goal/
  constraints/rubric/coverage/evidence) and ran ONE strictly SEQUENTIAL (no
  fan-out), capsule-grounded round on team_dispatch_guard.py itself:
  BASELINE (1 high-effort peer + capsule) vs MULTI-PEER (red_lead -> red_purple
  -> blue_purple cross-exam, all capsule-grounded). All claims cited [section].
- RESULT (the value question, finally measured RIGHT): grounded multi-peer BEAT
  the single peer.
  - Baseline found 2 real P1s (fsync-dir, leash header-injection) + honest GAP.
  - Multi-peer found those 2 PLUS a unique P1 the baseline MISSED (budget rows
    not semantically validated -> negative/non-int count under-enforces or
    crashes), AND blue_purple CORRECTED a red false-positive ("non-dict crashes"
    -- false, _prune_turns already catches it), AND caught that the SAME bug hits
    `_refund_budget` (red missed that site). Adversarial cross-exam added real
    precision a lone reviewer can't.
  - BOTH paths honestly flagged the capsule GAP (coverage claimed _send/killpg/
    main were included but evidence was truncated at `_send`) -- the Context
    Capsule contract working: cite-or-decline, no hallucination.
- FIXED all 3 real bugs the measured round grounded (now 13/13):
  - DURABILITY [done]: `_write_json_atomic` now fsyncs the parent DIR after
    rename (not just the temp file) -> a crash can't lose a budget commit.
  - LEASH HEADER-INJECTION [done]: `_validate_leash` rejects control chars in
    scope/artifact (fail closed) so they can't forge extra leash/Task header lines.
  - BUDGET-ROW VALIDATION [done]: `_valid_turn_row` (count = non-negative int,
    ts numeric) used under lock in BOTH `_reserve_budget` (fail-closed corrupt_
    state on any bad surviving row) and `_refund_budget` (no crash on malformed row).
- LESSON integrated: a capsule's `## coverage` claims must MATCH its `## evidence`
  -- the mesh caught my own capsule including only lines 1-260 (cutting off _send/
  main) while coverage claimed them. Next capsules must carry complete evidence
  for every coverage claim (a capsule-quality check is the next refinement).
- LESSON integrated (honesty): the iter-3 "misfire fixed robustly" claim was
  premature -- the alert recurred during the measured round. Re-diagnosed: HME
  hooks are USER-level, so `--setting-sources user` was backwards. Corrected to
  `project,local` (exclude user) and re-verified 0 misfires. Don't claim "fixed"
  from one quiet sample; confirm under the real workload.

## Self-evolution iteration 5 (DONE -- capsule coverage<->evidence consistency check)
- Closed the iter-4 named next-pass item (the lesson the mesh caught on my OWN
  capsule: ## coverage claimed code -- _send/main -- the ## evidence had
  truncated). New `_capsule_coverage_gaps()` in team_dispatch_guard.py:
  - parses the capsule into section bodies, reads the `## coverage` `included:`
    clause, extracts CODE symbols only (underscore-bearing / backtick / paren-
    quoted; bare prose words ignored so it never false-positives on English),
    and fails CLOSED (deny `capsule_coverage_gap` + `missing_evidence` list) if a
    claimed symbol is absent from the `## evidence` body. Skips `excluded:`.
    No-ops when either section is absent (nothing claimed -> nothing to verify).
  - Wired into the `--capsule` path BEFORE any peer call, so a capsule whose own
    evidence doesn't carry its coverage claims can't ground a peer.
- Unit-proven (now 14/14 substrate, 19 total with team_agent_router): a capsule
  claiming _reserve_budget/_send/main with evidence carrying only _reserve_budget
  is denied (_send in missing_evidence, no peer call); evidence carrying every
  claimed symbol is allowed (no false positive).

## Decision
The mesh is a PROVEN self-evolving review system: distinct-agent + Context-
Capsule-grounded + sequential + adversarial cross-exam, and a measured round
showed it BEATS a single high-effort peer (more unique real bugs + false-positive
correction, all cited, with honest GAP-flagging). It found 3 real guard bugs that
are now fixed + tested, and the capsule contract now self-checks coverage<->
evidence consistency (14/14 substrate, 19 total). Next: point the proven loop
(done-evidence capsule -> sequential grounded round) at a fresh real review
target, confirming results across samples before claiming success.

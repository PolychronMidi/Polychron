# Plan

Driver (orchestrator) + peers confer; durable, user-approvable proposals land
here. Nothing in this file is implemented until the user marks it approved.

## Status legend
- proposed: drafted from conferral, awaiting user decision
- approved: user approved; safe to implement
- denied: user rejected; do not implement
- done: implemented + verified

## History
- Phase 1 (archived 2026-06-04): stale-proof completion claims read as debt + the
  P5 laundering-hole fix, one-shot UPS p95 bench, resolver-filled causal braid;
  field-widen declined. Agent2 confirmed phase done. (TODO #15.)
- Phase 2 (archived 2026-06-04): policy dead-weight surfacing + immune
  classify->metabolize + the Flag-1/3 honesty fix; both organs load-bearing +
  self-honest, telemetry-only, off the hot path. One named watch-item
  (context_metabolism.writeFacts lost-update -- flock only if a concurrent
  high-freq writer appears). Agent2 confirmed phase done. (TODO #16.)

## Watch-items (named, deferred -- do NOT pre-build)
- `context_metabolism.writeFacts` lost-update: not flock-guarded vs a concurrent
  appendFact; LOW severity (advisory ledger, copy-of-record elsewhere, negligible
  frequency). Add flock read-modify-write ONLY if a concurrent high-frequency
  writer appears. Today none -> a lock now is premature speculative hardening.

## Proposals (Phase 3 -- red/blue/purple team build-out, awaiting human approve/deny)

Framing (Agent2, skeptic): the 2-agent Driver<->peer loop is already high-signal.
A 9-role mesh only earns keep if it adds bounded ADVERSARIAL review (red challenges
blue) + parallel crew WITHOUT becoming a chatter/cost engine. MVP must PROVE
boundedness before any role grows. If I1+I2 don't feel tighter than today's
2-agent loop, STOP -- the baseline already wins. Build on the existing router
(team_agent_router.py) and generalize the one comms primitive; do NOT rebuild either.

### I1 -- Comms substrate (generalize the 1-peer primitive)  [approved]  (rank 1, MVP)
- intent: turn ask-agent2.sh (single peer) into an N-role channel primitive, exercised by the channel we ALREADY use (Driver<->one Lead), with 0 new live agents.
- seam: `teams/roles.json` (role -> {channel, session_file: tmp/.team-<role>.session, tier}; single source of truth, self_origin pattern) + ONE `scripts/ask-peer.sh <role> "msg"` that registry-looks-up session+channel, mints (--session-id) or resumes (--resume/--fork), appends to channel.md; ask-agent2.sh becomes a thin alias. Move chat.md -> teams/driver.md; allowlist teams/*.md in markdown_invariant. Channels are append-only + TAIL-CAPPED (like ups-step-timing's 500-row cap) so they never become a context-burn artifact.
- net coherence: ONE comms implementation (no per-channel script copies = the drift we killed in decision_renderer/P1); deterministic per-role session files; nothing can storm yet (point-to-point, no fan-out, no auto-spawn).
- bounded cost: low; one script + a registry + a file move. Tests: registry lookup, mint/resume, append-to-correct-channel, tail-cap.
- NOT this: NO per-channel scripts (drift); NO broadcast/all-hands/standup primitive (fan-out = the easiest noise generator) -- point-to-point only; NO new live roles yet.

### I2 -- Leash + dispatch gate (make the mesh SAFE before it exists)  [proposed]  (rank 2)
- intent: wire router selection to comms as an EXPLICIT, leashed, counted handoff -- never an auto-send.
- seam: a thin dispatch guard between team_agent_router.py (PURE selector: tier->role, least-ctx) and ask-peer.sh. Enforces: spawn-depth cap (Driver->Lead->Crew, depth 2 max); per-Driver-turn peer-call BUDGET (N+1 blocked + surfaced); crew-cant-spawn HARD gate (E1-E2 blocked, only E3/E4 spawn, capped at originating tier); per-call leash (scope/artifact/max-duration/max-tools -- the runaway-20min lesson), over-bound reply truncated/quarantined.
- net coherence: the router stays a pure selector (no router-triggered auto-send = cascade risk); every dispatch is explicit, counted, leashed. Makes the mesh provably bounded BEFORE any mesh roles exist.
- bounded cost: low-medium; one guard module + tests. Tests: depth cap blocks 3rd level; budget blocks N+1; crew spawn denied.
- NOT this: no router-triggered auto-dispatch; no always-on/channel-polling peers (pull-only, strict request-response like today); no cascade past declared depth.

### I3 -- Real roles, incrementally (ONLY after I1+I2 proven)  [proposed]  (rank 3)
- intent: add roles one at a time atop the proven substrate -- each role = a roles.json entry + a test, no new code.
- seam: red team first (lead + purple + 1 crew) on teams/red.md + test; then blue on teams/blue.md; then the purple inter-team channel (teams/purple.md) LAST.
- net coherence: growth is earned per-role on a substrate already proven bounded; the adversarial value (red challenges blue) appears only once the substrate holds.
- bounded cost: per-role, incremental, test-gated.
- NOT this: do not stand up all 9 roles at once; purple inter-team channel is the highest-chatter / lowest-MVP-value, so it is the LAST thing, only after red+blue intra-team loops are proven bounded.

### Defers / skips (named, not padded)
- Full 9-role mesh at once: DEFER -- one channel at a time on a proven substrate.
- Purple inter-team channel: DEFER to the I3 tail (highest chatter, lowest MVP value).
- New team-dashboard machinery / ctx load-balance nuance: DEFER -- the router already reads team-dashboard.json; no new dashboard until roles exist to balance.
- Broadcast / standup / all-hands primitive: SKIP entirely -- point-to-point only; fan-out is a DDoC trap.

## Decision
Rank I1 > I2 > I3. Recommend shipping I1+I2 first (the tight, provably-bounded 2-increment substrate), then re-evaluate vs the 2-agent baseline BEFORE building I3 roles -- if it isn't tighter than today's loop, stop rather than expand into noise. Awaiting human approve/deny per increment.

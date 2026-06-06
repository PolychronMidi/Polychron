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
  2. TOOL-DISALLOW WAS LATER REJECTED: I temporarily blocked peer tools to stop
     long re-explore loops, but that neutered verification. Current standing fix
     is the opposite: forked peers keep FULL tool access and any filtering belongs
     only in the central proxy HME_FILTER_TOOLS_DROP path.
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
- This iteration temporarily tried context-blank peers to avoid driver-identity
  contamination. That was later REJECTED by the standing user directive because
  it nuked context and made tool-blocked peers fabricate instead of verify.
- Still-valid fixes from this iteration: channel writer uses REAL newlines (no
  JSON-escaped "\n"); HME_TEAM_PEER=1 makes peer sub-sessions no-op the driver
  lifecycle hooks (kills the UserPromptSubmit-before-SessionStart misfire);
  fixed an `env`-arg-order bug (assignments-before-`-u` -> exit 127).
- The mesh found REAL bugs in my own code; I fixed the top two and unit-proved
  them (now 9/9):
  - TIMEOUT-ORPHAN [done]: subprocess timeout killed only ask-peer.sh; the
    `claude` grandchild orphaned and kept spending (the exact orphan I'd been
    killing by hand). Fix: run the child in its own process group
    (start_new_session) and killpg the WHOLE group on timeout. Test proves the
    guard returns in ~2s, not 60s.
  - TAIL-CAP TURN-BLINDNESS [done]: real newlines let a raw `tail -n` bisect a
    turn. Fix: turn-atomic cap (keep last whole turns, never a fragment). Tested.
- Open debt from that point: hard output/byte cap on peer stdout; channel
  tag-forgeability; pass artifacts/prior findings into handoffs.

## Self-evolution iteration 3 (DONE -- close open debt + multi-step dialogue)
- Closed the iter-2 open debt (all unit-proven, now 12/12):
  - OUTPUT/BYTE CAP [done]: ask-peer caps captured claude JSON (head -c, 4MB);
    truncated JSON degrades to empty (no OOM).
  - TAG-FORGEABILITY [done]: channel writer neutralizes ALL structural tags in
    payloads (<driver/<peer/</...> -> guillemet form), so a reply can't spoof
    transcript structure. Test asserts exactly one real close tag.
  - GROUNDING [done]: guard --context-file / --capsule carry the artifact/prior
    findings into handoffs; this supplements, not replaces, forked context.
- Historical note: the round at that time argued for context-blank judges. That
  conclusion is superseded by the correction below: peers must be driver forks
  with full tool access. The useful survivor is the Context Capsule contract,
  not the context-nuking default.
- IMPLEMENTED the capsule contract: guard `--capsule` validates required sections
  (## artifact/## goal/## rubric) and wraps the task with the cite-or-decline
  contract. The contract remains useful as grounding for forked peers.
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
- DOGFOOD CATCH (real bug in iter-5's own code): building a done-evidence capsule
  for ask-peer.sh, the coverage check false-flagged cap_channel/append_turn_locked
  -- because the heading regex matched `#` CODE COMMENTS inside the fenced
  ## evidence block and truncated the body early. Root fix: `_capsule_headings()`
  is now FENCE-AWARE (a `#` line inside a ``` fence is a code comment, not a
  section heading); `_load_capsule` + `_capsule_section_bodies` both use it.
  Regression test added (now 15/15 substrate, 20 total): a # comment in fenced
  evidence no longer truncates, and a fake `# rubric` inside a fence no longer
  satisfies the required-section check.

## Team infra moved out of throwaway tmp/ into durable teams/ (build-out, not experiment)
- The capsules + round runners were living in tmp/i3-full and per-role sessions in
  tmp/.team-*.session -- tmp/ is wipe-prone scratch. This is a FEATURE build-out,
  so all team infra now lives under teams/:
  - teams/capsules/  -- tracked Context Capsules (guard.md, ask-peer.md, ctx_design.md)
  - teams/rounds/    -- tracked review-round runners (round_measured.sh, round_dialogue.sh)
  - teams/runtime/   -- ignored ephemeral state (*.session, channel-*.lock, tail.*,
                        output/); only README.md tracked.
- Coherent updates across the whole footprint: ask-peer.sh (session_file +
  LOCK_FILE + tail temp), roles.json (12 session paths), state-files.json (2 path
  contracts), .gitignore (track capsules/rounds, ignore teams/runtime/*),
  markdown_invariant (teams/capsules/ is an ALLOWED_PREFIX), and the substrate
  tests (session/lock paths).
- Honored two surfaced invariants instead of working around them: dir_intent
  READMEs added for the 3 new dirs; env-no-fallback FAIL (the moved runners
  carried `${PROJECT_ROOT:-...}` inline fallbacks that tmp/ had hidden from the
  scanner) fixed to fail-fast `${PROJECT_ROOT}`. Dropped 3 spent scratch runners
  (round_v3/run_full/review_fixes) whose value is already recorded above rather
  than force-staging path-marker-laden scratch.

## CORRECTION (standing user directive): peers = driver FORKS with FULL tools
- The earlier context-blank / tool-neutered conclusion was WRONG and is
  overridden. Nuking context AND blocking tools left peers unable to either see
  the project or verify anything -> they fabricated. That is the failure mode,
  not the design.
- SETTLED model (see teams/capsules/ctx_design.md):
  - context_mode = fork is the default for every role (ask-peer default +
    HME_TEAM_DEFAULT_CTX_MODE=fork + all 12 roles.json entries = fork). Each peer
    forks the driver session and inherits its FULL context.
  - FULL tool use: ask-peer's local tool-deny path is REMOVED. Tool filtering,
    where wanted, is enforced centrally at the proxy via HME_FILTER_TOOLS_DROP --
    one mechanism, not two.
  - context_mode=fork with no resolvable driver session id FAILS CLOSED.
- The capsule + cite-or-decline machinery remains available for grounding, but it
  is no longer a substitute for real forked context + live verification.

## Self-evolution iteration 6 (DONE -- forked/full-tool mesh reviewed ask-peer)
- Ran the measured sequential mesh round using the corrected substrate: peers were
  driver FORKS with full inherited context and full tool access. The round reviewed
  teams/capsules/ask-peer.md (rebuilt from the live ask-peer.sh source).
- Mesh findings that survived cross-exam and were fixed:
  - PATH CONFINEMENT [done]: string-glob checks like `teams/*.md` could allow
    traversal-shaped paths. ask-peer now allows only explicit channel files
    teams/{driver,red,blue,purple}.md and requires session files directly under
    teams/runtime/*.session (no nested/parent traversal).
  - FORK SID VALIDATION + PREFLIGHT [done]: driver/peer session ids now must match
    Claude UUID shape; invalid driver SID fails closed before any channel append;
    invalid peer SID is deleted/reforked from the valid driver SID. Launch
    preflight happens before appending the driver turn, preventing half exchanges.
  - PEER OUTPUT HARDENING [done]: claude stdout is captured to runtime files,
    byte-capped without a pipefail/SIGPIPE abort, parsed via tolerant Python, and
    malformed/truncated JSON becomes an explicit bounded peer-error turn instead
    of killing ask-peer after a driver-only append.
  - STDERR EVIDENCE [done]: peer stderr is per-call (`teams/runtime/<role>.<pid>.<ts>.stderr`)
    instead of per-role overwrite, preserving diagnostics.
  - DEAD NOISE [done]: removed the unused `json_string()` helper.
- Unit-proven (now 22/22 team tests): fork/full-tool launch has no local tool-deny
  arg, non-fork context is rejected, traversal-shaped channel/session paths are
  rejected, invalid driver SID leaves no half-turn, and bad peer JSON appends an
  explicit peer-error turn.

## Self-evolution iteration 7 (DONE -- residual output-cap race closed)
- Second sequential fork/full-tool mesh round on guard.md produced one actionable
  ask-peer residual: the stream-cap path used process substitution, which is
  bounded but does not let the parent `wait` for the capper before reading the cap
  file/truncation flag. That can race.
- Fixed: raw stdout now goes through a named FIFO into a capper process; ask-peer
  preserves the `claude` exit status, waits for the capper PID, drains all output
  while writing only the capped bytes, and fails closed with an explicit peer-error
  if the capper fails. No unbounded raw temp file is created.
- Unit/audit status stayed green (22/22 team tests, env failfast, silent-failure,
  shell-undefined, state ownership, markdown invariant, opencode host).

## Self-evolution iteration 8 (DONE -- fork-default kills stale-resume contamination)
- Third round (team_agent_router.py target) exposed a REAL fork/full-tool failure
  mode (NOT a reason to neuter): one peer ran to the 200s leash and was killed,
  another resumed its STALE per-role session and echoed the driver's current
  narration instead of reviewing the router. Root cause: ask-peer resumed an old
  per-role thread by default, and the leash was too short for full-tool review.
- Fixed without removing fork/tools:
  - DEFAULT RE-FORK [done]: every peer call now forks the CURRENT driver session by
    default (full context, no stale thread). Per-role memory is opt-in via
    HME_TEAM_RESUME_PEER_SESSIONS=1, which round_dialogue.sh sets for real debates.
  - LEASH HEADROOM [done]: round_measured.sh max_duration is 600s (env override
    HME_TEAM_ROUND_MAX_DURATION) and max_tools 8, so full-tool forked peers can
    actually verify against the tree instead of being killed mid-review.
- Unit-proven (now 23/23): default dispatch re-forks the driver even when a valid
  prior per-role session exists; HME_TEAM_RESUME_PEER_SESSIONS=1 resumes instead.

## Self-evolution iteration 9 (DONE -- router fixes + reviewer-charter hardening)
- Re-ran the router round with fork-default + 360s leash. All three peers
  (red, red_purple, cross) CONVERGED on the same 2 grounded team_agent_router.py
  bugs (no new unique find -- router is simpler than ask-peer), both fixed + tested:
  - CALLER NORMALIZATION [done]: resolve_target_for_tier (the API chokepoint the
    guard imports) now normalizes caller (str/strip/lower) so a stray-case/space
    caller like " Crew_E1_0 " can't ESCAPE _BLOCKED_CALLERS or mis-route a
    lead/driver to crew. Fails toward denial.
  - MALFORMED-STDIN GUARD [done]: main() wraps json.load(sys.stdin) in try/except
    (+ non-dict guard) -> deterministic rc-0 passthrough instead of a traceback
    that could let host crash-handling fail open. Mirrors _load() defensiveness.
  - 3 new router tests (26 team tests total): stray-space crew stays blocked,
    uppercase driver routes to a lead, malformed stdin returns rc 0 with no traceback.
- SUBSTRATE OBSERVATION + FIX: the forked peers burned most of their turn asking
  for write permission instead of reporting findings. Hardened the reviewer charter
  (ask-peer ROLE_SYSTEM + guard handoff) to state peers are REVIEWERS: report each
  finding as text (cite section + one-line fix), verify read-only, and never
  request tool/write grants or wait for approval.

## Self-evolution iteration 10 (DONE -- mesh reviewed its own harness; charter fix confirmed)
- Pointed the mesh at its OWN harness (teams/rounds/round_measured.sh via a new
  round-runner capsule). m_redp explicitly CONFIRMED the iter-9 charter fix worked:
  red_lead delivered grounded findings directly (no more "grant me write" waste).
- Applied the grounded harness P1s the round found:
  - STALE-RESULT LEAK [done]: OUT is cleared (rm m_*.json + m.err) at round start
    so a timed-out dispatch can't leave a prior run's reply read as current.
  - DASHBOARD SNAPSHOT/RESTORE [done]: per-run mktemp snapshot + an out-of-band
    HAD_DASH flag (not an in-band MISSING sentinel a real dashboard could collide
    with) + a checked restore cp that warns on failure.
  - DOWNSTREAM INJECTION [done]: a prior peer's reply is marker-neutralized (san:
    strip leading ## headings + GAP:) before being embedded in the next peer's
    --message, so a reply can't spoof capsule sections/GAP flags downstream.
- Applied two grounded operational fixes (full tools = real runtime risk to bound):
  - STDERR BOUND [done]: ask-peer prunes old per-role .stderr files (keep recent
    HME_TEAM_STDERR_KEEP=5) so per-call diagnostics can't accumulate unbounded.
  - STALE-TEMP SWEEP [done]: round start sweeps raw-cap/raw-trunc/reply/sid/raw-fifo
    temps a SIGKILL'd peer (EXIT trap skipped) may leak.
- Unit-proven (now 27 team tests): stderr files stay bounded; all prior guarantees
  hold. Env/silent/shell/state/markdown/opencode verifiers green.

## Self-evolution iteration 11 (DONE -- proxy filter_tools middleware)
- Built a fresh Context Capsule for tools/HME/proxy/middleware/03_filter_tools.js
  plus the imported load_env.js parser and ran one strictly sequential,
  fork/full-tool, capsule-grounded mesh round on the central tool-filter path.
- All peers converged on the same grounded P1 cluster, which was fixed at root:
  - OPTIONAL CONFIG NO-OP [done]: `_dropSet` no longer calls `requireEnv()` for
    HME_FILTER_TOOLS_DROP. Missing/blank drop lists now return an empty Set and
    leave payload.tools unchanged, matching the documented no-op contract.
  - ROOT-SCOPED + SIDE-EFFECT-FREE [done]: filter_tools no longer invokes the
    global `.env` loader or mutates process.env while handling a request. It reads
    only the existing process env value plus the passed `ctx.PROJECT_ROOT/.env`.
  - SHARED .env SYNTAX [done]: project .env parsing now reuses parseEnvFile, so
    `export`, quotes, and inline comments behave like the rest of the HME env path
    instead of failing open via an ad-hoc regex.
  - NO CWD FALLBACK [done]: when PROJECT_ROOT is absent, the middleware uses only
    explicit process.env and does not read whatever `.env` happens to be under the
    proxy process cwd.
- Regression tests added to compact_tool_descriptions.test.js for blank/missing
  no-op, exported/quoted values, no process.env mutation under unrelated broken
  interpolation, and no cwd fallback. Proxy + team tests are green (38/38).
- Mid-turn Lifesaver caught the live proxy still serving the stale `_hmeRequireEnv`
  module after the edit; verified the symbol was gone in source, smoke-tested the
  middleware, and HME health later showed no recent middleware errors.

## Self-evolution iteration 12 (DONE -- event-kernel host entry/adapters)
- Built a fresh Context Capsule for tools/HME/event_kernel/host_hook_entry.js and
  host_adapter_common.js and ran one strictly sequential, fork/full-tool,
  capsule-grounded mesh round on the host hook entry path.
- The mesh converged on grounded event-kernel P1s; applied them without weakening
  peer tools or bypassing policy:
  - PEER BYPASS NARROWED [done]: HME_TEAM_PEER now bypasses only lifecycle/loop
    events (SessionStart/UserPromptSubmit/Stop/PreCompact/PostCompact). Peer
    PreToolUse/PostToolUse/PermissionRequest events still flow through the host
    adapter, so full-tool peers remain governed and observable.
  - ENTRY STDIN BOUNDED [done]: host_hook_entry.js no longer readFileSyncs stdin
    unbounded before the adapter cap can apply. It drains stdin with the same 1MB
    cap and emits fail-safe deny output for gating events on read/size failure.
  - ENTRY CHILD TIMEOUT [done]: adapter spawnSync now has a wall-clock timeout and
    SIGKILL killSignal, with event-appropriate fail-safe output on timeout/error.
  - ADAPTER OVERSIZE FAIL-CLOSED [done]: host_adapter_common readStdin no longer
    exits 0/no-decision on oversized input. It relays a valid deny for
    PreToolUse/PermissionRequest and no-ops only for non-gating events.
  - PROXY RESPONSE/WAIT BOUNDS [done]: postLifecycle caps proxy response bytes and
    treats cap overflow as transport failure that falls back/direct-dispatches;
    per-attempt proxy timeout is bounded at 15s instead of a 60s + retry stall.
  - ROOT RESOLUTION HARDENING [done]: resolveRoot now prefers the adapter's own
    repo ancestry before process.cwd, avoiding accidental binding to an unrelated
    checkout when PROJECT_ROOT is absent.
- Regression tests added to decision_and_route_registry.test.js for peer lifecycle
  bypass boundaries, gating fail-safe output, stdin/proxy byte caps, and proxy
  attempt timeout. Event/materialization tests and the wider team/proxy suite are
  green (47 node tests + host materialization). Coherence checks green.

## Decision
The mesh is a PROVEN self-evolving review system: driver-FORK peers with FULL
tool access (real context + live verification), sequential, capsule-grounded,
adversarial. Over iterations 6-12 the corrected fork/full-tool mesh found and
fixed real bugs in ask-peer (path confinement, SID preflight, output/parse
hardening, FIFO raw-cap, stderr bound), team_agent_router (caller normalization,
malformed-stdin guard), its own harness (stale-result leak, dashboard
snapshot/restore, downstream injection), proxy middleware (optional config no-op,
root-scoped side-effect-free filtering, shared env syntax, no cwd fallback), and
event-kernel host entry/adapters (peer lifecycle bypass narrowing, bounded stdin,
adapter timeout, oversize fail-closed gating, proxy response/wait bounds, root
resolution hardening) -- all without neutering peers. The reviewer-charter fix is
behaviorally confirmed. Next: keep pointing the loop at fresh load-bearing HME
surfaces under the same discipline.

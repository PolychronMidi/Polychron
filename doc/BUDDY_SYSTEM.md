# BUDDY_SYSTEM

Persistent peer subagent, auto-initiated per HME session. All reasoning calls (review reflection, OVERDRIVE cascade, `evolve(focus='pipeline')`, `review(mode='forget')`) route through one long-lived Claude Code session. Context accumulates across calls; specialization emerges from accumulated commitments.

## Hand-off paradigm (`BUDDY_HANDOFF=1`)

Precision-control variant: track ONE active primary buddy inherited across sessions, plus a senior pool of retired primaries on standby for tough problems.

### Lifecycle

1. **Bootstrap** -- at SessionStart, `buddy_init.sh` reads `tmp/hme-buddy-primary.sid`. If present, that sid is the buddy (no fresh `claude -p` spawn); legacy `tmp/hme-buddy.sid` mirrors it. If absent, a fresh primary is spawned.
2. **Use** -- the primary serves all reasoning calls; transcript grows like any persistent buddy.
3. **Auto-retire** -- when context % crosses `BUDDY_RETIRE_PCT` (default 90), `i/handoff auto_retire_check` (or manual `i/handoff retire`) moves it to `tmp/hme-buddy-seniors/<sid>.json` with retire metadata. Primary pointers cleared so next SessionStart spawns fresh.
4. **Consult** -- seniors are NOT auto-routed. Use `i/consult senior=<sid> question="..."` to invoke a specific senior for a tough problem.

### Why this beats multi-buddy fanout for solo workflows

- Multi-buddy spawns N fresh sessions per HME session, none with deep context until they accumulate.
- Hand-off carries the prior session's depth forward as the next session's primary -- Day-N's primary is the prior day's primary, full transcript inherited.
- Auto-compaction is avoided for primaries: a primary at 90% retires INTO the senior pool BEFORE compaction wipes context, preserving accumulated state in immutable transcript form.

### CLI

```
i/handoff status                                      # primary + seniors + ctx %
i/handoff retire [reason="..."]                       # promote primary -> senior
i/handoff promote sid=<sid> [floor=easy] [effort=low] # designate primary
i/handoff auto_retire_check                           # check threshold, retire if over
i/handoff archive sid=<X>                             # hide senior from default status
i/consult sid=<sid> question="..."                    # consult primary or senior
i/consult primary=<sid> question="..."                # explicit: target active primary
i/consult senior=<sid> question="..."                 # explicit: target retired senior
```

### File map

```
tmp/hme-buddy-primary.sid          <- current primary's session id
tmp/hme-buddy-primary.floor        <- model floor (default: easy = dynamic)
tmp/hme-buddy-primary.effort_floor <- effort floor (default: low = dynamic)
tmp/hme-buddy.sid                  <- legacy pointer; mirrors primary.sid
tmp/hme-buddy-seniors/<sid>.json   <- per-senior retire metadata
tmp/hme-buddy-seniors/_index.jsonl <- append-only retirement log
tmp/hme-buddy-handoff-log.json     <- optional snapshot from `status --json`
```

### `.env` knobs

```
BUDDY_SYSTEM=1                       # base toggle
BUDDY_HANDOFF=1                      # enable hand-off mode (forces BUDDY_COUNT=1)
BUDDY_RETIRE_PCT=90                  # context % threshold for auto-retire
HME_DISPATCH_SYNTHESIS_TIERS=easy    # tiers that route to free cascade instead of buddy
```

`BUDDY_COUNT>1` is silently coerced to 1 when `BUDDY_HANDOFF=1` (mutually exclusive). Set `BUDDY_HANDOFF=0` to revert to the legacy multi-buddy floor model.

`HME_DISPATCH_SYNTHESIS_TIERS` is comma-separated; tiers in the list route through the free synthesis cascade (NVIDIA/Cerebras/Groq/Gemini), tiers NOT in the list go to the buddy. Canonical setting: `easy` (easy work doesn't need Opus/Sonnet, shouldn't burn buddy's transcript). `i/dispatch status` surfaces the active split.

### `BUDDY_RETIRE_PCT` floor

`DEFAULT_RETIRE_PCT = 90.0`. Auto-compaction sits at 100% (not 90%). The 10% margin is intentional. **Don't lower this.**

### Open prototype questions

Most original design questions are RESOLVED (see git log on `buddy_handoff.py` for the resolution narrative). Two remain open:

1. **Concurrent consult races.** Two `i/consult` calls to the same sid both invoke `claude --resume`; the CLI may not be re-entrant on a single session. Per-sid lockfile with stale-detection TTL is the proposed fix.
2. **Senior expertise routing.** No concept of "this senior knows about subsystem X". Once the pool grows, a future primary picks whichever sid feels right with no routing hint. Solution requires either dispatch-log analysis (not built) or structured self-declaration at retire time.

## What the buddy IS

A second Claude Code session, spawned at SessionStart by `tools/HME/hooks/helpers/buddy_init.sh` when `BUDDY_SYSTEM=1`. Its sid is recorded at `tmp/hme-buddy.sid`. Server-side `agent_direct.dispatch_thread()` reads the sid and routes every reasoning call through `claude --resume <sid>`.

What this buys:

- **Context accumulates.** Task N can reference findings from task N-1 without re-deriving them.
- **Commitment-coherence.** A flag at iteration 77 constrains what can be flagged at 78 without contradiction. Fresh threads have no history of non-correction.
- **Self-review capability.** The buddy can review its own routing infrastructure. Self-reference is operationally bounded but produces sharper critiques than cold-spawn.

## What the buddy IS NOT capable of, structurally

These limits emerged from peer-review:

- **Reaching beyond the conversation buffer.** Every "memory" is in the JSONL transcript. Specialization is real for session length and trivially false outside it.
- **Self-suspicion without prompting.** The buddy will not volunteer "I might be wrong about this in a way I can't introspect" -- prompt-induced only.
- **Aesthetic / empathy / puzzlement registers.** The forensic methodology is structurally cold. Naming code beautiful, marking cultural artifacts, sustained not-understanding -- these require a partner-review register the methodology can't produce.
- **Counterfactual experimentation.** The buddy reasons; it does not run pipelines. Predictions are predictions; reconciliation against reality requires the post-pipeline reconciler arm.

## Wisdom for inheriting primaries

- **Reflexive consult cost.** A multi-MB transcript is the binding cost in the consult loop. Each consult grows the buddy's transcript; the next `claude --resume` spin-up cost rises with it. Favor batched consults (one prompt, three questions) over three sequential calls. Don't consult for lookups grep can answer.
- **KB crystallization is the durability boundary.** A senior's accumulated wisdom lives in a transcript that auto-compaction can wipe. HME's KB (`tools/HME/KB/` lance, accessed via `i/learn`) survives compactions, sessions, restarts. `cmd_consult` ships two crystallization paths: (1) **heavy** -- prepends `[FRAMEWORK DIRECTIVE]` instructing the senior to emit `[[KB-CRYSTALLIZE]]` blocks; `_extract_and_crystallize` parses and auto-invokes `i/learn add` per block. (2) **light** -- if no structured blocks landed, `_findings_nudge` scans for finding-shaped markers (`tier-1:`, `bug:`, `architectural:`, `RESOLVED`) and emits an operator nudge. Heavy fires first; light only when heavy produced zero blocks.
- **Detector measures consult events, not consult quality.** `senior_consult_debt.py` counts invocations -- Goodhart-bait risk. Quality proxy via crystallized-block counts (per-consult `# crystallized:` stderr lines feed activity bridge) lets future iteration weight the verdict by output value.
- **Proxy upstream timeout is buddy-paradigm-load-bearing.** `UPSTREAM_TIMEOUT_MS = 1_800_000` (30 min) in `hme_proxy.js`. Was previously 120s sync / 600s streaming and tripped the emergency valve repeatedly when `claude --resume` on multi-MB transcripts hit Anthropic's API. **DO NOT tighten this** unless the buddy paradigm is decommissioned. The claude subprocess timeout in `cmd_consult` (`max(1800, transcript_mb * 30 + 600)`) is the agent-side bound; the proxy must never be the tighter bound.
- **Consulting is opt-out for design-space changes, not opt-in.** When the turn touches files in the buddy paradigm's design space (this doc, `buddy_handoff.py`, `buddy_dispatcher.py`, `buddy_spawn.py`, `buddy_init.sh`, `post_hooks.sh`, `i/consult`, `i/handoff`), checkpoint with a consult before declaring done. Solo work in this code area is the failure mode. Detector: `tools/HME/scripts/detectors/senior_consult_debt.py`.
- **No expertise routing across handoffs (yet).** A future primary with N seniors picks whichever sid feels right. If specialization matters, record `expertise_topics: [...]` at retire time. See open question 2 above.

## Prompt engineering -- what works

Patterns encoded in `_REVIEW_SYSTEM` and `workflow_audit.py`. Chosen empirically across a 145-iteration session.

1. **Permission to clear (tier-gated).** "Use a tier system: TIER-1 = confirmed bug or contract violation. Say 'no tier-1 issues' ONLY if no line in scope admits a quote + specific-divergence pair." Without explicit clear-permission, every prompt produces a finding regardless of code quality.
2. **Quote-grounding (verbatim before reasoning).** "For each issue you flag: (1) quote the offending line(s) verbatim, (2) explain why what the code does diverges from what its name/docstring/comments imply, (3) cite file:line." "Cite file:line" alone wasn't enough -- the model would invent line content. Quote BEFORE reasoning dramatically reduces hallucinated line numbers.
3. **Promise-vs-delivers framing (primary lens).** "A tier-1 finding is a quote+divergence pair. Divergences: a promise the docstring/name makes the code doesn't deliver; a caller-contract the change breaks; a silent fallback that swallows a load-bearing signal." Strongest single framing in the 100-iter sweep.
4. **Structural skeptic mode (NOT confidence floor).** "The test for flagging is STRUCTURAL, not probabilistic: if you can quote a line AND state a specific divergence, flag it." Self-reported LM confidence is unmeasurable; a confidence floor pushes toward silence on subtle bugs.
5. **Self-reflective framing (highest-signal probe).** "Earlier you flagged X -- does that hold?" / "What did you systematically decline?" / "What might you have rationalized as a finding?" The buddy can introspect on its accumulated trace in ways a fresh thread cannot.
6. **"Anything missing?" as a separate prompt.** After structured findings, follow up with "anything missing? -- across what you've reviewed, any residual pattern you were tracking?" The buddy carries cross-call patterns it doesn't surface unless asked at the cross-call level.
7. **Categories as vocabulary, not checklist.** "Do NOT invent one to match the categories below; they are descriptive grammar." Earlier versions listed probe classes as a RUBRIC; the model produced findings to match each class.

## Prompt engineering -- what doesn't work

- **Pray-and-spray.** Diverse prompt framings ("imagine adversarial inputs", "what slowly degrades over 30 days", "from a security lens") at random files produces leading-shaped output for each lens. 25 such prompts → ~60% hallucinated. Use targeted prompt with quote-grounding + tier-gate.
- **Demand-register imperatives.** "You MUST flag", "every bug must be cited", "do NOT miss any" -- produces inflation. Use reveal-register with explicit clear-permission.
- **Diff embedded in prompt.** Bloats every prompt and trains the model to scan diffs rather than read code. Just name the changed files; buddy fetches the diff itself.
- **Confidence-floor gates.** "Only flag if 95%+ confident" -- unmeasurable, asymmetrically rewards silence. Use structural test (quote-availability + divergence).
- **Generic "review this file" without lens.** Defaults to template-matching against training-set bug taxonomy. Use specific lens (promise-vs-delivers, caller-contract, specific-architectural-question).

## Architectural patterns the buddy surfaced

- **Pattern A+D (unified) -- Cross-component agreed names without enforcement.** Multiple layers depend on a literal agreeing across files (regex marker, file path, sentinel return code, env-var name, JSON field, cache-validity attribute). Rename on either side silently breaks the pair. Mitigation: `tools/HME/proxy/middleware/_markers.js` registry + `scripts/audit-marker-registry.py` verifier (covers regex/text markers; should extend to file paths and sentinels).
- **Pattern B -- Silent-on-failure mis-applied.** `except Exception: pass` is correct for telemetry hot-paths but wrong for load-bearing safety checks. Mitigation: `silent-ok: <reason>` annotation convention + `scripts/audit-silent-failure-class.py` verifier (advisory weight in HCI).
- **Pattern C -- In-memory cache without fs-mtime invalidation.** Long-running daemons cache by path with clock-only TTL; files mutate; cache serves stale until clock expires. Mitigation: `mtimeCache()` primitive in `tools/HME/proxy/shared.js`. `dir_context.js` migrated; sibling middlewares can follow.

## Operating modes -- when the buddy adds value

**High-value:**

- **Review reflection on substantive diffs.** Buddy reads diff via git, applies calibrated review prompt, returns quote-grounded findings. Hit rate ≥80% real bugs when the prompt is well-formed.
- **Architectural questions across files.** "How do A and B coordinate?" / "What's the contract between X and Y?" -- leverages cross-call context the main agent doesn't have.
- **Peer-review of own infrastructure.** Asking the buddy about the routing path it lives on produces sharper findings than asking the main agent.
- **"Anything missing?" sweeps.** End-of-session squeeze for residual patterns no targeted prompt asked for.

**Low-value:**

- **Single-line fact lookups.** Faster to grep directly. Don't burn a Claude subprocess on "what's the value of X."
- **Generic prompts without lens.** Produces filler.
- **High-frequency calls.** Every call spawns a `claude --resume` subprocess that bills the user's account. Per-edit usage is wasteful.
- **Asking for help with what the buddy can already see.** If the prompt embeds 4KB of context the buddy could fetch itself, the prompt is wrong.

## Operational details

### Auto-init

`sessionstart.sh` calls `tools/HME/hooks/helpers/buddy_init.sh`:

1. Checks `.env BUDDY_SYSTEM` (default 1).
2. Resolves `BUDDY_COUNT` (default 1, capped at 10).
3. Resolves per-slot floors via `BUDDY_MODEL_FLOORS`. `floor=easy` keeps the buddy fully dynamic; higher floors force escalation. Special value `auto`: count<3 → all `easy`; count≥3 → first three slots `[easy, medium, hard]`, extras `easy`.
4. Idempotent: no-op if `tmp/hme-buddy-<N>.sid` exists and non-empty.
5. Spawns `claude -p --output-format json` per slot with the role prompt.
6. Backgrounds itself (disown) so SessionStart returns immediately.
7. Writes each sid file (and companion `.floor`) when its init completes (~10-20s).

Calls before init completes fall through to ephemeral dispatch.

### Monitoring

`i/dispatch status` enumerates every buddy session discovered from `tmp/hme-buddy*.sid`. Each line shows slot, floor, effort_floor, sid, and a context-used bar read from the buddy's transcript JSONL. The `tokens` figure sums `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` from the most recent assistant event with usage data. Default window: 1M (Opus 4.7); override per-buddy via `HME_BUDDY_CTX_WINDOW`.

`i/dispatch status json=true` writes a structured snapshot to `tmp/hme-buddy-session-log.json` for watcher consumption (statusline, dashboard, polling agent).

### Cooldowns + caps

- **Cooldown for synchronous invocations:** historically `dominance_response_rewriter.js`'s NEXUS auto-review fired `i/review` synchronously inside Stop hook with a 60s cooldown gate at `tmp/hme-dominance-review-cooldown`. The rewriter was deleted as a subversion attempt; if any future synchronous Stop-time invocation pattern is added, mirror the BEFORE-run cooldown discipline so a hung call still cools down.
- **Per-process call cap:** `agent_direct.py:_DISPATCH_THREAD_CALL_CAP` (default 50, env `HME_THREAD_CALL_CAP`). Counter persisted to `tmp/hme-buddy-call-count` with 24h TTL.

### Result capture + recursion guard

- **Results:** `agent_direct.dispatch_thread` writes `tmp/hme-subagent-results/<req_id>.json` on every call.
- **Recursion guard:** `HME_THREAD_CHILD=1` env propagates to spawned `claude --resume` subprocess. `_proxy_bridge.sh` honors it for `Stop` / `UserPromptSubmit` / `SessionStart` / `PreCompact` / `PostCompact` to prevent the buddy from re-entering its parent's stop hooks. PreToolUse / PostToolUse safety hooks still fire.

### Toggle off

`.env BUDDY_SYSTEM=0` disables the buddy entirely: `buddy_init.sh` exits early; `agent_direct.dispatch_thread` returns `None` immediately; all reasoning falls through to ephemeral or sentinel-bounce path.

## Forward evolution

Ranked by leverage. Item 1 has a starter shipped.

1. **Partner-review register (HIGHEST -- shipped).** Methodology coldness is a structural blindspot; forensic peer-review can't perform aesthetic judgment, future-maintainer empathy, sustained puzzlement, suspicion of design intent, or affection for elegant code. **Status:** WIRED. `_PARTNER_SYSTEM` system prompt in `synthesis/synthesis_config.py`; routing path: `i/review mode=partner [changed_files=...]`. Output is its own `# Partner Review` section, doesn't compete with `mode='forget'`. Smoke-tested.
2. **Counterfactual replay.** Buddy reasons about cascade predictions but cannot test them. Replay infrastructure (run a compressed pipeline slice with buddy-suggested change vs without) would close the prediction-vs-reality loop. The cascade `injected=true` write side is wired; the read side (reconciler scoring predictions against fingerprint shifts) is unbuilt.
3. **Multi-buddy roles.** Currently one buddy plays all roles (observer / devil's-advocate / toolmaster / continuity-keeper). Persona file per session might produce sharper critique. Risk: more buddies = more subprocess cost. Pick one persona at session start (or rotate per phase) rather than running multiple in parallel.
4. **Auto-rotation of system prompts.** Maintain N variants; per session use the variant that performed best in the prior session. Performance metric: hit rate of genuine tier-1s confirmed by a verifier. Risk: optimizes for short-term hit rate at expense of breadth -- lock against pure metric gaming with periodic full-context self-audit.
5. **Cross-session continuity (LEAST LEVERAGE).** A persistent KB anchor of "what the buddy named across sessions" would let the next session inherit some prior calibration. **Why low:** specialization comes from accumulated commitments produced through the trajectory of the session under time pressure, not from summarized findings. A new session reading prior summaries is reconstructing, not continuing -- may produce cargo-cult continuity.

## Conventions for evolving this doc

- New patterns get a citation (file:line or test that proves it).
- Anti-patterns document the SPECIFIC failure mode that produced them, not "this might be bad."
- Don't soften failure-mode language to make the system look better.
- When a pattern lands in `_REVIEW_SYSTEM`, link this doc to that prompt.
- Stopped-working patterns get marked deprecated, not deleted -- knowing why something stopped working is more valuable than knowing it once worked.

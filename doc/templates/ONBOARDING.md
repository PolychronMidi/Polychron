# Agent Primer

Self-evolving algorithmic composition. A ~500-file JavaScript engine produces MIDI -> WAV -> neural analysis. HME is the evolutionary nervous system; you invoke it as `i/<tool>` shell wrappers (e.g. `i/review`, `i/learn`, `i/status`). The proxy middleware translates those into the underlying MCP tool calls -- you never connect to the MCP server yourself. The music and HME co-evolve: improving one improves the other.

**Where this primer sits in the agent's context surface.** Three documents share the load, and they are not redundant:

- [AGENTS.md](../../AGENTS.md) -- the **rules**. Load order, firewalls, hypermeta-first discipline, hard rules. Loaded into every prompt. Authoritative.
- This primer -- the **behavior**. What you do in your first session, in what order, with what redirects. The hook emits only a compact pointer to this file on first HME tool use; it does not paste this whole document into context.
- [HME.md](../HME.md) -- the **reference**. Short HME orientation that links into the full substrate reference. Read on demand when the primer points you at something specific.

**Continuity.** Session continuity comes from proxy-enriched native tools, status views, KB retrieval, and onboarding state. For context health, use `i/status state` or `i/status timeline`.

If you see a rule claim here that contradicts AGENTS.md, AGENTS.md wins -- this primer should not be restating rules, only describing behavior.

## How the walkthrough works

Every new session starts in onboarding state `boot`. The chain decider -- living inside the HME MCP server -- auto-runs prerequisites and advances state as you make tool calls. You never write state; hooks and handlers do it for you.

**The rules you actually need:**
- Make one `i/<tool>` call per step. Prerequisites run silently and prepend their output to the result.
- When a hook blocks you with "call X instead," X is the next correct move. No retry dance -- just call X and the state advances.
- While editing composition code, also watch HME itself. Any stale KB entry, wrong constraint, missing hook coverage, broken enforcement -- note it, report it at step 7 in your `learn()` content under an `## HME observations` section.
- **LIFESAVER is meant to be painful.** If a LIFESAVER alert fires, do not add a cooldown/throttle/dedup to silence it. Either fix the condition (so it stops firing naturally) or fix the detector (so it correctly distinguishes real from false). Dampening alerts is a structural violation caught by the `LifesaverIntegrityVerifier` at weight 5.0. Full specification including the calibration-vs-dampening distinction and allowed/forbidden moves: [doc/hme_full.md](../hme_full.md).
- **No psychopathic polling.** When waiting for a long-running background task, do NOT repeatedly `tail`/`wc`/`cat` its output, `nvidia-smi`, or `ps | grep`. The background task fires a completion notification automatically. Do parallel work (unrelated to the running task) until then. The `pretooluse_bash.sh` hook blocks the 3rd polling-style bash call in a turn.

## The loop (one session, one evolution)

State machine -- 7 forward-only states, advancement is automatic via tool handlers + hooks:

```
boot --[i/hme admin action=selftest passes]-->
  selftest_ok --[i/evolve focus=design|forge|curate|stress|invariants]-->
    targeted --[Edit on /src/ (briefing auto-chains)]-->
      edited --[i/review mode=forget reports zero warnings]-->
        reviewed --[Bash: npm run main]-->
          piped --[STABLE | EVOLVED verdict]-->
            verified --[i/learn title=... content=...]-->
              graduated  (state file deleted)
```

You never call an HME read wrapper explicitly -- the briefing is woven into native Read/Edit on tracked files automatically. Each step either advances state automatically or gets blocked with a one-line redirect telling you the exact next call. If a call gets denied, the reason is the lesson.

**If you lose the thread mid-session**, run `i/status mode=all` -- it reports the current onboarding state, which step is in progress, the rolling metrics, and the most recent pipeline verdict. The correct next call is in that output. `i/status mode=hme` is the narrower version when you only need the onboarding state.

## Other HME tools (use when needed)

### Observability triad -- three orthogonal questions

```
i/status state                           snapshot: every state machine in one ~10-line view
i/status timeline window=5m|1h           chronological audit trail of silent automations
i/status holograph                       interstellar overview: one row per HME horizon (all 10 dimensions at once)
i/why mode=...                             causality (see modes below)
```

### `i/why` modes -- answers "why did X happen / what caused / what would happen"

```
i/why <invariant-id>                     full provenance + rationale for an invariant
i/why mode=block                         most recent hook/policy block + how to opt out
i/why mode=state                         current onboarding state explanation
i/why mode=verifier <name>               status + history + run() body for one verifier
i/why mode=verifier-utility              meta-meta: which verifiers are dead weight
i/why mode=verifier-coverage             which dirs are under-covered by verifiers
i/why mode=verifier-drift                which verifiers' status hasn't changed in N runs
i/why mode=hci-drop                      most recent HCI regression + which verifiers flipped
i/why mode=hook                          recent hook firings (broader than mode=block)
i/why mode=kb-graph                      KB citation/supersession edges + orphan map
i/why mode=predict <file>                which verifiers historically flipped on edits to this dir
i/why mode=conscience                    approved/rejected move signatures from ground-truth log
i/why mode=causality <event>             heuristic causal chain leading to <event>
i/why mode=fractal-shape                 tensegrity-shape Gini at every architectural scale
i/why "<free-text>"                      Tier-2 retrieval: grep + KB + activity citation packet
i/why "<free-text>" --deep               Tier-3 subagent synthesis on top of Tier-2 packet
```

### `i/status` modes -- pipeline + meta + horizon views

```
i/status                                 four-arc brief (default)
i/status mode=hme                        session state + recent activity
i/status mode=hci-diff                   verifier deltas since last run
i/status mode=hci-by-subtag              what KIND of broken everything is
i/status mode=agent-loop                 Horizon IV: agent loop quality
i/status mode=band-tuning                Horizon IX: band proposal from ground-truth
i/status mode=conjugate                  Horizon V: HCI <=> perceptual quadrants
i/status mode=multi-axis-band            Horizon II: per-subtag bands (BELOW/IN_BAND/ABOVE)
i/status mode=tool-latency               Horizon I: per-tool p50/p95/p99 cost preflighting
i/status mode=...                          ~35 other modes -- see `i/help status`
```

### Compositional tools

```
i/trace target=...                         signal flow: L0 cascade, module chains, causal chains
i/trace target=... mode=snapshot           beat state: S3 / 2:1:3:0 / 400 -> regime, trust, notes
i/review mode=full                       digest + regime + trust in one call
i/review mode=composition                section arc, drama finder, hotspot leaderboard
i/review mode=health                     codebase health sweep
i/evolve focus=forge                     executable lab sketch for top unsaturated bridge
i/evolve focus=curate                    KB-worthy patterns from recent pipeline runs
i/evolve focus=invariants                40 declarative structural checks
i/evolve focus=stress                    35 adversarial enforcement probes
i/evolve focus=contradict                KB conflict scanner
i/learn query=...                          KB search
i/learn action=health                    KB staleness check
i/hme admin action=index                 reindex after batch changes
i/hme admin action=reload                hot-reload tool modules
TodoWrite                                Claude native task list; HME merges persistent
                                         critical and TODO.md items automatically
```

(Run `i/help` for the full wrapper surface and `i/help <name>` for usage.

## Todo system

Claude's native `TodoWrite` is the public todo surface. Codex uses `update_plan`,
which syncs into TODO.md automatically through the Codex proxy, with universal
pulse as a fallback scanner. The HME layer adds the following transparently:

- **Subtodos + auto-completion.** Internal HME todo entries can carry subtodos; the native view shows them as indented rows (`  + text`).
- **Critical flag.** Pass `critical=True` on add. Critical items surface at every turn start via `userpromptsubmit.sh` until resolved. LIFESAVER alerts auto-append as critical.
- **on_done triggers.** Pass `on_done='reindex'|'learn'|'commit'` to fire a lifecycle hook when the item is marked done. `reindex` runs `i/hme admin action=index` in the background. `learn` queues a reminder to call `i/learn` at the next turn. `commit` flags a commit nudge in the nexus.
- **Onboarding stays separate.** The current walkthrough step appears in status output, not as persistent tasks.
- **Cross-session persistence.** Open items from the previous session surface at `SessionStart` with a diff view. Completed items live in the store history until auto-pruned or archived.
- **Live mermaid graph.** The store writes a live rendering to [output/metrics/todo-graph.md](../../output/metrics/todo-graph.md) on every change. Use this to see the work tree as a diagram.

## Rules and boundaries -- authoritative source

[AGENTS.md](../../AGENTS.md) is loaded in every prompt -- the single source of truth for coding rules, load order, architectural firewalls, hypermeta-first discipline, and hard rules. Treat its rules as always-on constraints. The walkthrough section above surfaces the three onboarding-critical rules (LIFESAVER no-dilution, no psychopathic polling, one tool call per step) -- the rest live in AGENTS.md.

## Phase 1-6 HME infrastructure

A set of post-composition instrumentation features -- musical correlation, coherence budget, trajectory, prediction accuracy, trust weights, crystallization, constitution, and related -- all wired into `main-pipeline.js` POST_COMPOSITION and refreshed by every `npm run main`. Surfaced through the `status(mode=...)` branches. You don't need to remember the internals; just the per-round workflow below and which mode answers which question. For the full subsystem narrative, see [hme_full.md](../hme_full.md).

### Per-round workflow when the user reports a listening verdict

```
1. i/learn action=ground_truth title=SECTION content=COMMENT \
          tags=[moment_type,sentiment] query=ROUND_TAG
   (SECTION: S0..S6 or 'all'. moment_type: convergence|climax|breath|
   arrival|misfire|... sentiment: compelling|surprising|moving|flat|
   mechanical|... Writes output/metrics/hme-ground-truth.jsonl + mirrors to
   KB with tag `human_ground_truth` -> unconditional HIGH trust tier)

2. i/learn title="RNN ..." content="..." category=decision
   Normal KB calibration anchor.

3. python3 tools/HME/activity/emit.py --event=round_complete \
       --session=RNN --verdict=STABLE
   CRITICAL: your edits before the user ran the pipeline are still in
   the activity window. The coherence score will report 0 until you
   emit round_complete to close that window. Do this BEFORE rebuilding
   the derived metrics -- order matters.

4. node scripts/pipeline/compute-coherence-score.js
   python3 scripts/pipeline/compute-kb-trust-weights.py
   python3 scripts/pipeline/derive-constitution.py
   Rebuild the derived metrics against the now-bounded window. The
   pipeline POST_COMPOSITION already ran them once but with the
   polluted pre-round_complete window; this is the clean pass.

5. i/status mode=music_truth | i/status mode=budget |
   i/status mode=trajectory -- inspect what the round did to the
   rolling metrics. Report deltas to the user.
```

### Status mode map -- which mode answers which question

(23 new modes landed 2026-04-15. Plus pre-existing: `pipeline`, `health`, `coupling`, `trust`, `perceptual`, `hme`, `freshness`, `vram`, `introspect`, `resume`, `all`.)


- `music_truth` -- did the pipeline produce good music? (hme_coherence vs perceptual correlation)
- `budget` -- is coherence in the sweet spot? (homeostatic band, state BELOW/OPTIMAL/ABOVE)
- `trajectory` -- is the music evolving or plateauing? (GROWING/PLATEAU/DECLINING over N rounds)
- `accuracy` -- is HME's causal model learning? (clean vs injected prediction EMA)
- `kb_trust` -- which KB entries are most trustworthy? (HIGH/MED/LOW tiers + ground-truth override)
- `crystallized` -- what patterns has HME crystallized? (multi-round patterns from >=3 members * >=3 rounds)
- `constitution` -- what does Polychron fundamentally IS? (positive identity claims)
- `staleness` / `doc_drift` -- what KB modules are stale / missing?
- `blindspots` -- what has HME structurally avoided?
- `probes` -- where might cascade predictions be wrong? (adversarial candidates)
- `negative_space` -- what architectural gaps does topology predict?
- `cognitive_load` -- what is HME's cognitive load?
- `hypotheses` -- what's in the hypothesis registry?
- `activity` -- what activity events just fired?
- `intention_gap` -- which proposals did HME propose but not execute?
- `reflexivity` -- does HME's self-model influence its own predictions?
- `generalizations` -- which patterns could generalize beyond Polychron?
- `doc_drift` -- are any docs drifted from KB reality?
- `self_audit` -- is HME's own architecture failing anywhere?
- `ground_truth` -- ground-truth entries recorded?
- `multi_agent` -- multi-agent inter-role coherence (if split)?

### History depth requirements

Most derived metrics need rolling history to become meaningful. Until the threshold is met, the metric reports an explicit not-ready state rather than a misleadingly confident value.

- **trajectory verdict** -- needs >=5 rounds. Until then `i/status` returns `INSUFFICIENT`.
- **coherence budget derived band** -- needs >=8 rounds. Until then uses prior `[0.55, 0.85]`.
- **prediction-accuracy EMA** -- needs >=10 rounds with cascade calls logged. Seed via `i/trace target=... mode=impact`.
- **crystallizer patterns** -- needs >=3 members * >=3 rounds. None promoted until threshold.
- **musical-correlation *r*** -- needs >=3 aligned pairs. Until then correlation not reported.

Exact "current" counts drift every round; query `i/status mode=trajectory` or `i/status mode=budget` to see where the rolling window sits right now rather than treating any number in this list as live.

**DO NOT edit `src/` while accumulating the baseline.** Keep composition frozen for 5-8 runs so Phase 4-6 metrics calibrate on a stable codebase. After that, every evolution has a real signal on whether it moved the system inside/outside the productive coherence band.

### Gotcha: coherence score = 0 after an active edit session

The activity bridge emits `file_written` events for every edit under `src/` or `tools/HME/(mcp|chat|activity|hooks|scripts)/`. If you edited HME instrumentation in your turn (or a previous compaction did), those events are in the current round window and tank `read_coverage`. **Always emit `round_complete` via `tools/HME/activity/emit.py` before you trust the score.** The `stop.sh` hook does this automatically at turn end, but a mid-turn pipeline run won't have triggered it yet.

## Reference (as needed)

- [AGENTS.md](../../AGENTS.md) -- authoritative rule set, loaded every prompt. Read first on any new session where the walkthrough does not answer the question.
- [doc/HME.md](../HME.md) -- short HME orientation. Read this before deeper substrate detail.
- [tools/HME/service/server/onboarding_chain.py](../../tools/HME/service/server/onboarding_chain.py) -- chain decider source + design spec (decorator wiring, gate hooks, failure modes, "adding new steps" recipe). The state machine itself is documented above in this primer.
- [doc/hme_full.md](../hme_full.md) -- HME internals, tool surface, event kernel, state registry, LIFESAVER, and self-coherence.
- [doc/composition-full.md](../composition-full.md) -- beat lifecycle, signal flow, L1/L2 layer isolation, tuning context, and engine systems.
- [doc/theory/](../theory/) -- long-form arguments for the architecture's commitments. Read when the *why* behind a rule is needed.
- `python3 tools/HME/scripts/verify-numeric-drift.py` -- audit counted claims ("N hypermeta controllers" / "K verifiers" / etc.) across all markdown against live code counts. Fires via the `numeric-claim-drift` HCI verifier every pipeline run.
- `python3 scripts/audit-core-principles.py` -- survey `src/` against the five core principles. Fires via the `core-principles-audit` HCI verifier every pipeline run. Critical violations (files >400 LOC, subsystems without `index.js`) drop HCI; 200-line warnings are informational.
- `python3 scripts/audit-shell-hooks.py` -- static scan of `tools/HME/hooks/**/*.sh` for cache-trap patterns (BASH_SOURCE-relative ascents that resolve INTO the plugin cache when hooks are invoked from it). Fires via the `shell-hook-audit` HCI verifier every pipeline run. Sister-audit to ESLint-for-JS and `_scan_python_bug_patterns`-for-Python.
- Proxy middleware substrate at [tools/HME/proxy/middleware/](../../tools/HME/proxy/middleware/) owns tool-result transformation. Export `onToolResult({toolUse, toolResult, ctx})` to append, replace, or enrich any Claude-native tool's result before the model sees it. `ctx.replaceResult` swaps content entirely; `ctx.retryNextTurn(toolUseId)` defers unfinished work to a future turn (bounded, 3-retry max). Working examples: `background_dominance.js` resolves backgrounded `i/*` stubs into real output, `bash_enrichment.js` surfaces error snippets. Load failures are caught by the `proxy-middleware-registry` HCI verifier. Tests live next to the code they exercise (`test_*.js`), excluded from middleware registration by the loader.
- Calibration anchors live in KB (`i/learn query=...`). The historical `output/metrics/journal.md` is a retired archive.

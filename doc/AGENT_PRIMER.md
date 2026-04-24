# Agent Primer

Self-evolving algorithmic composition. A ~500-file JavaScript engine produces MIDI → WAV → neural analysis. HME (six MCP tools, exposed through the `i/` wrappers) is the evolutionary nervous system. The music and HME co-evolve: improving one improves the other.

**Where this primer sits in the agent's context surface.** Three documents share the load, and they are not redundant:

- [CLAUDE.md](../CLAUDE.md) — the **rules**. Load order, firewalls, hypermeta-first discipline, hard rules. Loaded into every prompt. Authoritative.
- This primer — the **behavior**. What you do in your first session, in what order, with what redirects. Injected once per session by `pretooluse_hme_primer.sh` on your first HME tool call.
- [HME.md](./HME.md) — the **reference**. Full HME narrative, tool surface, Phase 1-6 subsystem detail. Read on demand when the primer points you at something specific.

If you see a rule claim here that contradicts CLAUDE.md, CLAUDE.md wins — this primer should not be restating rules, only describing behavior.

## How the walkthrough works

Every new session starts in onboarding state `boot`. The chain decider — living inside the HME MCP server — auto-runs prerequisites and advances state as you make tool calls. You never write state; hooks and handlers do it for you.

**The rules you actually need:**
- Make one tool call per step. Prerequisites run silently and prepend their output to the result.
- When a hook blocks you with "call X instead," X is the next correct move. No retry dance — just call X and the state advances.
- While editing composition code, also watch HME itself. Any stale KB entry, wrong constraint, missing hook coverage, broken enforcement — note it, report it at step 7 in your `learn()` content under an `## HME observations` section.
- **LIFESAVER is meant to be painful.** If a LIFESAVER alert fires, do not add a cooldown/throttle/dedup to silence it. Either fix the condition (so it stops firing naturally) or fix the detector (so it correctly distinguishes real from false). Dampening alerts is a structural violation caught by the `LifesaverIntegrityVerifier` at weight 5.0. Full specification including the calibration-vs-dampening distinction and allowed/forbidden moves: [doc/LIFESAVER.md](./LIFESAVER.md).
- **No psychopathic polling.** When waiting for a long-running background task, do NOT repeatedly `tail`/`wc`/`cat` its output, `nvidia-smi`, or `ps | grep`. The background task fires a completion notification automatically. Do parallel work (unrelated to the running task) until then. The `pretooluse_bash.sh` hook blocks the 3rd polling-style bash call in a turn.

## The loop (one session, one evolution)

```
 1. hme_admin(action='selftest')            → boot check
 2. evolve(focus='design')                  → pick target module
 3. Edit                                    → KB briefing auto-chains into the Edit hook;
                                              constraints/callers/risks appear as a
                                              systemMessage before the edit runs
 4. review(mode='forget')                   → audit changes against KB (must be clean)
 5. Bash: npm run main                      → run the pipeline (run_in_background=true)
 6. STABLE | EVOLVED verdict                → auto-commit, hooks advance state
 7. learn(title=, content=)                 → persist the round + HME observations
```

You never call `read(mode='before')` explicitly — the briefing is woven into every Edit on a `/src/` file automatically by the pretooluse hook. Each step either advances state automatically or gets blocked with a one-line redirect telling you the exact next call. If a call gets denied, the reason is the lesson.

**If you lose the thread mid-session**, run `i/status mode=all` — it reports the current onboarding state, which step is in progress, what the rolling metrics look like, and what the most recent pipeline verdict was. From that output the correct next call is almost always obvious. `i/status mode=hme` is the narrower version when you only need the onboarding state.

## Other HME tools (use when needed)

```
trace(target)                           signal flow: L0 cascade, module chains, causal chains
trace(target, mode='snapshot')          beat state: S3 / 2:1:3:0 / 400 → regime, trust, notes
review(mode='full')                     digest + regime + trust in one call
review(mode='composition')              section arc, drama finder, hotspot leaderboard
review(mode='health')                   codebase health sweep
evolve(focus='forge')                   executable lab sketch for top unsaturated bridge
evolve(focus='curate')                  KB-worthy patterns from recent pipeline runs
evolve(focus='invariants')              40 declarative structural checks
evolve(focus='stress')                  35 adversarial enforcement probes
evolve(focus='contradict')              KB conflict scanner
learn(query='...')                      KB search
learn(action='health')                  KB staleness check
hme_admin(action='index')               reindex after batch changes
hme_admin(action='reload')              hot-reload tool modules
hme_todo(action='add', text=..., parent_id=..., critical=..., on_done=...)
                                        hierarchical extension of TodoWrite (subs, critical,
                                        on_done triggers 'reindex'/'learn'/'commit')
```

## Todo system

Native `TodoWrite` works as usual. The HME layer adds the following transparently:

- **Subtodos + auto-completion.** Use `hme_todo(action='add', parent_id=N, text='...')` to add a sub under #N. A main todo is marked done only when all its subs are done; marking the last sub done auto-completes the parent. The native view shows subs as indented rows (`  └ text`).
- **Critical flag.** Pass `critical=True` on add. Critical items surface at every turn start via `userpromptsubmit.sh` until resolved. LIFESAVER alerts auto-append as critical.
- **on_done triggers.** Pass `on_done='reindex'|'learn'|'commit'` to fire a lifecycle hook when the item is marked done. `reindex` runs `hme_admin(action='index')` in the background. `learn` queues a reminder to call `learn()` at the next turn. `commit` flags a commit nudge in the nexus.
- **Onboarding walkthrough appears in your native todo list.** The current step is always marked `in_progress`, completed steps are marked done, upcoming steps are pending. You don't need to manage it — hooks do.
- **Cross-session persistence.** Open items from the previous session surface at `SessionStart` with a diff view. Completed items live in the store history until `clear` is called.
- **Live mermaid graph.** The store writes a live rendering to [output/metrics/todo-graph.md](../metrics/todo-graph.md) on every change. Use this to see the work tree as a diagram.

## Rules and boundaries — authoritative source

[CLAUDE.md](../CLAUDE.md) is loaded in every prompt and is the single source of truth for coding rules, load order, architectural firewalls, hypermeta-first discipline, and hard rules (binaural range, `tmp/run.lock` untouchable, plan-abandonment discipline, etc.). This primer does not restate those — read CLAUDE.md and treat its rules as always-on constraints. The handful of onboarding-critical rules the walkthrough section above lists (LIFESAVER no-dilution, no psychopathic polling, one tool call per step) are the ones this primer surfaces because they are mostly relevant *during the first-session walkthrough itself*.

## Phase 1-6 HME infrastructure

A set of post-composition instrumentation features — musical correlation, coherence budget, trajectory, prediction accuracy, trust weights, crystallization, constitution, and related — all wired into `main-pipeline.js` POST_COMPOSITION and refreshed by every `npm run main`. Surfaced through the `status(mode=...)` branches. You don't need to remember the internals; just the per-round workflow below and which mode answers which question. For the full subsystem narrative, see [HME.md](./HME.md).

### Per-round workflow when the user reports a listening verdict

```
1. learn(action='ground_truth', title=SECTION, content=COMMENT,
         tags=[moment_type, sentiment], query=ROUND_TAG)
   (SECTION: S0..S6 or 'all'. moment_type: convergence|climax|breath|
   arrival|misfire|... sentiment: compelling|surprising|moving|flat|
   mechanical|... Writes output/metrics/hme-ground-truth.jsonl + mirrors to
   KB with tag `human_ground_truth` → unconditional HIGH trust tier)

2. learn(title='RNN ...', content='...', category='decision')
   Normal KB calibration anchor.

3. python3 tools/HME/activity/emit.py --event=round_complete \
       --session=RNN --verdict=STABLE
   CRITICAL: your edits before the user ran the pipeline are still in
   the activity window. The coherence score will report 0 until you
   emit round_complete to close that window. Do this BEFORE rebuilding
   the derived metrics — order matters.

4. node scripts/pipeline/compute-coherence-score.js
   python3 scripts/pipeline/compute-kb-trust-weights.py
   python3 scripts/pipeline/derive-constitution.py
   Rebuild the derived metrics against the now-bounded window. The
   pipeline POST_COMPOSITION already ran them once but with the
   polluted pre-round_complete window; this is the clean pass.

5. status(mode='music_truth') / status(mode='budget') /
   status(mode='trajectory') — inspect what the round did to the
   rolling metrics. Report deltas to the user.
```

### Status mode map — which mode answers which question

(23 new modes landed 2026-04-15. Plus pre-existing: `pipeline`, `health`, `coupling`, `trust`, `perceptual`, `hme`, `freshness`, `vram`, `introspect`, `resume`, `all`.)


| Question | Mode |
| --- | --- |
| Did the pipeline produce good music? | `music_truth` (hme_coherence vs perceptual correlation) |
| Is coherence in the sweet spot? | `budget` (homeostatic band, state BELOW/OPTIMAL/ABOVE) |
| Is the music evolving or plateauing? | `trajectory` (GROWING/PLATEAU/DECLINING over N rounds) |
| Is HME's causal model learning? | `accuracy` (clean vs injected prediction EMA) |
| Which KB entries are most trustworthy? | `kb_trust` (HIGH/MED/LOW tiers + ground-truth override) |
| What patterns has HME crystallized? | `crystallized` (multi-round patterns from ≥3 members × ≥3 rounds) |
| What does Polychron fundamentally IS? | `constitution` (positive identity claims) |
| What KB modules are stale / missing? | `staleness` / `doc_drift` |
| What has HME structurally avoided? | `blindspots` |
| Where might cascade predictions be wrong? | `probes` (adversarial candidates) |
| What architectural gaps does topology predict? | `negative_space` |
| What is HME's cognitive load? | `cognitive_load` |
| What's in the hypothesis registry? | `hypotheses` |
| What activity events just fired? | `activity` |
| Which proposals did HME propose but not execute? | `intention_gap` |
| Does HME's self-model influence its own predictions? | `reflexivity` |
| Which patterns could generalize beyond Polychron? | `generalizations` |
| Are any docs drifted from KB reality? | `doc_drift` |
| Is HME's own architecture failing anywhere? | `self_audit` |
| Ground-truth entries recorded? | `ground_truth` |
| Multi-agent inter-role coherence (if split)? | `multi_agent` |

### History depth requirements

Most derived metrics need rolling history to become meaningful. Until the threshold is met, the metric reports an explicit not-ready state rather than a misleadingly confident value.

| Metric | Threshold | Until then |
| --- | --- | --- |
| trajectory verdict | ≥5 rounds | status returns `INSUFFICIENT` |
| coherence budget derived band | ≥8 rounds | uses prior `[0.55, 0.85]` |
| prediction-accuracy EMA | ≥10 rounds with cascade calls logged | seed via `trace(target, mode='impact')` |
| crystallizer patterns | ≥3 members × ≥3 rounds | none promoted until threshold |
| musical-correlation *r* | ≥3 aligned pairs | correlation not reported |

Exact "current" counts drift every round; query `status(mode='trajectory')` or `status(mode='budget')` to see where the rolling window sits right now rather than treating any number in this table as live.

**DO NOT edit `src/` while accumulating the baseline.** Keep composition frozen for 5-8 runs so Phase 4-6 metrics calibrate on a stable codebase. After that, every evolution has a real signal on whether it moved the system inside/outside the productive coherence band.

### Gotcha: coherence score = 0 after an active edit session

The activity bridge emits `file_written` events for every edit under `src/` or `tools/HME/(mcp|chat|activity|hooks|scripts)/`. If you edited HME instrumentation in your turn (or a previous compaction did), those events are in the current round window and tank `read_coverage`. **Always emit `round_complete` via `tools/HME/activity/emit.py` before you trust the score.** The `stop.sh` hook does this automatically at turn end, but a mid-turn pipeline run won't have triggered it yet.

## Reference (consult as needed)

- [CLAUDE.md](../CLAUDE.md) — authoritative rule set, loaded every prompt. Read first on any new session where the walkthrough does not answer the question.
- [doc/HME_ONBOARDING_FLOW.md](./HME_ONBOARDING_FLOW.md) — state machine spec. Read this if the chain surprises you.
- [doc/HME.md](./HME.md) — HME internals, tool surface, Phase 1-6 per-subsystem narrative.
- [doc/ARCHITECTURE.md](./ARCHITECTURE.md) — beat lifecycle, signal flow, L1/L2 layer isolation.
- [doc/hme-discoveries.md](./hme-discoveries.md) — human-curated universal principles promoted from HME's generalization drafts.
- [doc/theory/](./theory/) — long-form arguments for the architecture's commitments. Read when the *why* behind a rule is needed.
- `python3 tools/HME/scripts/verify-numeric-drift.py` — audit counted claims ("N hypermeta controllers" / "K verifiers" / etc.) across all markdown against live code counts. Fires via the `numeric-claim-drift` HCI verifier every pipeline run.
- `python3 scripts/audit-core-principles.py` — survey `src/` against the five core principles. Fires via the `core-principles-audit` HCI verifier every pipeline run. Critical violations (files >400 LOC, subsystems without `index.js`) drop HCI; 200-line warnings are informational.
- `python3 scripts/audit-shell-hooks.py` — static scan of `tools/HME/hooks/**/*.sh` for cache-trap patterns (BASH_SOURCE-relative ascents that resolve INTO the plugin cache when hooks are invoked from it). Fires via the `shell-hook-audit` HCI verifier every pipeline run. Sister-audit to ESLint-for-JS and `_scan_python_bug_patterns`-for-Python.
- Proxy middleware substrate at [tools/HME/proxy/middleware/](../tools/HME/proxy/middleware/) owns tool-result transformation. Export `onToolResult({toolUse, toolResult, ctx})` to append, replace, or enrich any Claude-native tool's result before the model sees it. `ctx.replaceResult` swaps content entirely; `ctx.retryNextTurn(toolUseId)` defers unfinished work to a future turn (bounded, 3-retry max). Working examples: `background_dominance.js` resolves backgrounded `i/*` stubs into real output, `bash_enrichment.js` surfaces error snippets. Load failures are caught by the `proxy-middleware-registry` HCI verifier. Tests live next to the code they exercise (`test_*.js`), excluded from middleware registration by the loader.
- Calibration anchors live in KB (`i/learn query=…`). The historical `output/metrics/journal.md` is a retired archive.

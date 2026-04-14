# Agent Primer

Self-evolving algorithmic composition. 482 JS files produce MIDI → WAV → neural analysis. HME (6 MCP tools) is the evolutionary nervous system. The music and HME co-evolve: improving one improves the other.

## How the walkthrough works

Every new session starts in onboarding state `boot`. The chain decider — living inside the HME MCP server — auto-runs prerequisites and advances state as you make tool calls. You never write state; hooks and handlers do it for you.

**The rules you actually need:**
- Make one tool call per step. Prerequisites run silently and prepend their output to the result.
- When a hook blocks you with "call X instead," X is the next correct move. No retry dance — just call X and the state advances.
- While editing composition code, also watch HME itself. Any stale KB entry, wrong constraint, missing hook coverage, broken enforcement — note it, report it at step 7 in your `learn()` content under an `## HME observations` section.
- **LIFESAVER is meant to be painful.** If a LIFESAVER alert fires, do not add a cooldown/throttle/dedup to silence it. Either fix the condition (so it stops firing naturally) or fix the detector (so it correctly distinguishes real from false). Dampening alerts is a structural violation caught by the `LifesaverIntegrityVerifier` at weight 5.0.
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

- **Subtodos + auto-completion.** Use `hme_todo(action='add', parent_id=N, text='...')` to add a sub under #N. A main todo is marked done only when all its subs are done; marking the last sub done auto-completes the parent. The native view shows subs as indented rows (`  └─ text`).
- **Critical flag.** Pass `critical=True` on add. Critical items surface at every turn start via `userpromptsubmit.sh` until resolved. LIFESAVER alerts auto-append as critical.
- **on_done triggers.** Pass `on_done='reindex'|'learn'|'commit'` to fire a lifecycle hook when the item is marked done. `reindex` runs `hme_admin(action='index')` in the background. `learn` queues a reminder to call `learn()` at the next turn. `commit` flags a commit nudge in the nexus.
- **Onboarding walkthrough appears in your native todo list.** The current step is always marked `in_progress`, completed steps are marked done, upcoming steps are pending. You don't need to manage it — hooks do.
- **Cross-session persistence.** Open items from the previous session surface at `SessionStart` with a diff view. Completed items live in the store history until `clear` is called.
- **Live mermaid graph.** The store writes a live rendering to [metrics/todo-graph.md](../metrics/todo-graph.md) on every change. Use this to see the work tree as a diagram.

## Guardrails

**Load order** (strict): `utils → conductor → rhythm → time → composers → fx → crossLayer → writer → play`

**Firewalls** (ESLint-enforced):
- conductor cannot write crossLayer state (read-only via `conductorSignalBridge`)
- crossLayer cannot register with conductor (only local `playProb`/`stutterProb` mods)
- inter-module communication via L0 channels only (`L0_CHANNELS.xxx` constants, never bare strings)
- coupling matrix reads only inside `src/conductor/signal/balancing/`, `meta/`, profiler, diagnostics

**Ownership:** 19 meta-controllers own all coupling constants. Never hand-tune what a controller manages. `check-hypermeta-jurisdiction.js` enforces across 4 phases. Modify controller logic instead.

**New feedback loops:** register with `feedbackRegistry` + declare in `metrics/feedback_graph.json`.

## Hard Rules

- **Binaural 8-12Hz only.** Never experiment with frequency. `setBinaural` from `grandFinale` post-loop ONLY.
- **Never remove `tmp/run.lock`.** Pipeline running or abandoned — never your problem to delete.
- **Never abandon a plan mid-execution.** Finish the atomic unit before pivoting.
- **Fail fast.** `validator.create('ModuleName')` for all checks. No `|| 0`, no silent returns.
- **Globals via `require()` side-effects** in `index.js` files. Never `global.`/`globalThis.`.
- **Comments terse.** One-line inline where logic is not self-evident. No essays.
- **Auto-commit** after verified STABLE/EVOLVED runs. Never commit DRIFTED/FAILED.

## Reference (consult as needed)

- [doc/HME_ONBOARDING_FLOW.md](./HME_ONBOARDING_FLOW.md) — state machine spec (read this if the chain surprises you)
- [CLAUDE.md](../CLAUDE.md) — complete rule set, loaded every prompt
- [doc/ARCHITECTURE.md](./ARCHITECTURE.md) — beat lifecycle, signal flow, L1/L2 layer isolation
- [doc/HME.md](./HME.md) — HME internals, databases, evolution loop
- [metrics/journal.md](../metrics/journal.md) — listening verdicts and calibration anchors

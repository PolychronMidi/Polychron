# Agent Primer

Self-evolving algorithmic composition. 482 JS files produce MIDI → WAV → neural analysis. HME (6 MCP tools) is the evolutionary nervous system. The music and HME co-evolve: improving one improves the other.

## How the walkthrough works

Every new session starts in onboarding state `boot`. The chain decider — living inside the HME MCP server — auto-runs prerequisites and advances state as you make tool calls. You never write state; hooks and handlers do it for you.

**The rules you actually need:**
- Make one tool call per step. Prerequisites run silently and prepend their output to the result.
- When a hook blocks you with "call X instead," X is the next correct move. No retry dance — just call X and the state advances.
- While editing composition code, also watch HME itself. Any stale KB entry, wrong constraint, missing hook coverage, broken enforcement — note it, report it at step 8 in your `learn()` content under an `## HME observations` section.

## The loop (one session, one evolution)

```
 1. hme_admin(action='selftest')            → boot check
 2. evolve(focus='design')                  → pick target module
 3. read(target, mode='before')             → absorb KB constraints, callers, risks
 4. Edit                                    → apply the change on target
 5. review(mode='forget')                   → audit changes against KB (must be clean)
 6. Bash: npm run main                      → run the pipeline (run_in_background=true)
 7. STABLE | EVOLVED verdict                → auto-commit, hooks advance state
 8. learn(title=, content=)                 → persist the round + HME observations
```

Each step either advances state automatically or gets blocked with a one-line redirect telling you the exact next call. If a call gets denied, the reason is the lesson.

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
```

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

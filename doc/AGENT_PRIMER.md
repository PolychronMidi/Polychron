# Agent Primer

Self-evolving algorithmic composition. 482 JS files produce MIDI, rendered to WAV, analyzed by neural codecs. HME (6 MCP tools) is the evolutionary nervous system — KB, architectural analysis, enforcement hooks. They co-evolve: improving the music improves HME, improving HME improves the music.

## Boot

```
/HME                                    load skill (once per session)
```

## Work Loop

A block IS a diagnostic — read it, fix the cause, continue.

```
read("module", mode="before")           pre-edit: KB constraints + callers + boundaries + risks
  -> edit
review(mode='forget')                   post-edit: auto-detects changed files from git
npm run main                            pipeline (run_in_background=true, ~5-10 min)
  STABLE/EVOLVED -> auto-commit         descriptive message, all changed files
  FAILED -> read pipeline output, fix root cause
learn(title='...', content='...')       persist calibration anchors after user-confirmed rounds
```

Hooks enforce each adherence, completion, and transition.

## Intelligence

**Search & Diagnosis**
```
trace(target)                           signal flow: L0 cascade, module chains, causal chains
trace(target, mode='snapshot')          beat state: S3 / 2:1:3:0 / 400 → regime, trust, notes
```

**Evolution Planning**
```
evolve()                                next target: dead-ends, bypasses, gaps, antagonism bridges
evolve(focus='design')                  antagonist bridge: dimension + code location + rationale
evolve(focus='forge')                   executable lab sketch for top unsaturated bridge
evolve(focus='curate')                  KB-worthy patterns from recent pipeline runs
evolve(focus='invariants')              40 declarative structural checks
evolve(focus='stress')                  35 adversarial probes: hooks, ESLint, LIFESAVER, docs
evolve(focus='contradict')              KB conflict scanner
```

**Post-Run Analysis**
```
review(mode='full')                     digest + regime + trust in one call
review(mode='composition')              section arc, drama finder, hotspot leaderboard
```

## Guardrails

**Load order** (strict): `utils -> conductor -> rhythm -> time -> composers -> fx -> crossLayer -> writer -> play`

**Firewalls** (ESLint-enforced):
- conductor cannot write crossLayer state (read-only via `conductorSignalBridge`)
- crossLayer cannot register with conductor (only local `playProb`/`stutterProb` mods)
- inter-module communication via L0 channels only (`L0_CHANNELS.xxx` constants, never bare strings)
- coupling matrix reads only inside `src/conductor/signal/balancing/`, `meta/`, profiler, diagnostics

**Ownership**: 19 meta-controllers own all coupling constants. Never hand-tune what a controller manages. `check-hypermeta-jurisdiction.js` enforces across 4 phases. Modify controller logic instead.

**New feedback loops**: register with `feedbackRegistry` + declare in `metrics/feedback_graph.json`.

## Hard Rules

- **Binaural 8-12Hz only.** Never experiment with frequency. `setBinaural` from grandFinale post-loop ONLY.
- **Never remove `tmp/run.lock`.** Pipeline running or abandoned — never your problem to delete.
- **Never abandon a plan mid-execution.** Finish the atomic unit before pivoting.
- **Fail fast.** `validator.create('ModuleName')` for all checks. No `|| 0`, no silent returns.
- **Globals via `require()` side-effects** in `index.js` files. Never `global.`/`globalThis.`.
- **Comments terse.** One-line inline where logic is not self-evident. No essays.
- **Auto-commit** after verified STABLE/EVOLVED runs. Never commit DRIFTED/FAILED.

## Verify Bootstrap

```
hme_admin(action='selftest')            0 FAILs = tools + index + KB healthy
evolve(focus='invariants')              0 errors = structural coherence holds
```

If either fails, the output tells you exactly what to fix.

## Reference (consult as needed, not upfront)

- `CLAUDE.md` -- complete rule set, loaded every prompt (229 lines)
- `doc/ARCHITECTURE.md` -- beat lifecycle, signal flow, L1/L2 layer isolation
- `doc/HME.md` -- HME internals, databases, evolution loop
- `doc/7_LAYERS.md` -- self-coherence audit: current state of all 7 layers
- `metrics/journal.md` -- listening verdicts and calibration anchors

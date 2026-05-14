# HME Evolution Loop, Mandatory Workflow & Autonomous Mode

> Detail for HME's evolution-loop integration, the mandatory per-session workflow, lab governance, and the autonomous ralph-loop. Linked from [HME.md](HME.md).

## Evolution Loop Integration

HME is the cognitive backbone of every evolution phase. The loop is driven by lifecycle hooks rather than a dedicated subagent -- each phase calls HME tools directly.

| Phase | HME Role | Tools |
--
| **1. Perceive** | Surface patterns from metrics, KB context on changed files | `learn(query='...')` |
| **2. Diagnose** | Trace causal chains with KB constraints, find anti-patterns | `trace(target)`, `evolve(focus='blast', query='...')` |
| **3. Evolve** | KB briefing auto-chained into Edit hook (no explicit call needed) | `Edit` (hook surfaces KB constraints), `learn(query='module')` |
| **4. Run** | Pipeline executes; file watcher auto-reindexes (5min cooldown) | (automatic) |
| **5. Verify** | Post-change audit, missed constraint detection | `review(mode='forget')`, `review(mode='convention')`, `review(mode='health')` |
| **6. Persist** | Persist findings to KB / docs | `learn(title='...', content='...')`, `learn(action='graph')`, `learn(action='promote_discovery')` |
| **7. Maintain** | Reindex, KB health check, doc sync | `hme_admin(action='index')`, `learn(action='health')`, `review(mode='docs')` |

**After every confirmed round:**
1. File watcher auto-reindexes (or `hme_admin(action='index')` for batch changes)
2. `learn(title='...', content='...', category='pattern')` -- persist calibration anchors to KB
3. `learn(action='compact')` -- if KB > 30 entries, deduplicate
4. Update CLAUDE.md and relevant doc files if architectural rules changed

**Retired:** `output/metrics/journal.md` is no longer an active surface (deprecated). Existing content kept as historical archive; evolution tooling still reads it for past-round context.


## Lab Governance

The lab (`lab/run.js` + `lab/sketches.js`) is HME's experimental substrate. Lab sketches prototype behavior via monkey-patching before integration into `/src`.

**Lab rules (enforced by hooks):**
- Every `postBoot()` must create AUDIBLE behavior via real monkey-patching
- No empty sketches (just calling `setActiveProfile` tests nothing)
- No `V` (validator) in lab -- use `Number.isFinite` directly
- No `crossLayerHelpers` -- use inline layer logic
- Don't return values from void functions

**Lab + KB cycle:**
1. Write sketch with real implementation code
2. Run via `node lab/run.js`
3. Listen to output, compare with baseline
4. If confirmed: extract to `/src`, `learn(title=, content=, category='pattern')` for the finding
5. If refuted: `learn(title=, content=, category='pattern')` to prevent re-attempting


## Mandatory Workflow

The per-session walkthrough that enforces this workflow is documented in [ONBOARDING.md](templates/ONBOARDING.md) -- a linear state machine driven by a chain-decider middleman ([onboarding_chain.py](../tools/HME/service/server/onboarding_chain.py)) living inside the MCP server. New sessions start in state `boot` and graduate only after one full loop (selftest -> evolve -> edit -> review -> pipeline -> commit -> learn). The KB briefing that used to be a separate `read(target, mode='before')` step is now auto-chained into every `Edit` via the pretooluse hook.

### Before Editing Code

The `pretooluse_edit.sh` hook surfaces KB constraints automatically whenever you call the native `Edit` tool on a file under `/src/`. You do NOT need to call any HME tool first -- the briefing is auto-chained into every Edit. KB constraints appear as `systemMessage` on the permission-allow response before the edit runs.

The full-briefing internal function (`read(target, mode='before')`) still exists as a hidden utility for scripted use, but agents never call it directly -- hooks handle everything transparently.

### After Code Changes

1. **`i/review mode=forget`** -- auto-detects changed files from git. Checks against KB constraints, boundary rules, L0 channels, doc needs. Optionally pass `changed_files=file1.js,file2.js` to override.
2. File watcher auto-reindexes on save (5s debounce, 5min cooldown between full reindexes)
3. For batch changes: `i/hme-admin action=index` once at the end

### After Confirmed Round

1. `i/learn title=... content=... category=pattern` for calibration anchors, decisions, anti-patterns
2. Use `tags=supersedes:<id>` / `tags=derived_from:<id>` / `tags=contradicts:<id>` to link related entries (see `i/why mode=kb-context <id>` for traversal)
3. Update docs: CLAUDE.md, relevant doc/*.md files

### For Any Search

Use `i/learn query=...` for KB semantic search, `i/trace target=...` for signal flow / caller chains, or the native `Grep` tool (which is passthru-enriched with KB context via the HME hook). All searches add KB cross-referencing that bare Grep misses.

### When Pipeline Fails

Read pipeline output, then `i/evolve focus=blast query=<symbol>` for dependency traces or `i/learn query=<error text>` for similar-KB-bug lookup.

### When Lost Mid-Session

Three orthogonal observability surfaces cover the entire "what's happening in HME right now" question space:

- **`i/status state`** -- snapshot of every state machine (onboarding, NEXUS, pipeline lock, fingerprint verdict, KB freshness, HCI multi-timescale phase, last hot-reload, pending KB drafts) in one ~10-line view.
- **`i/why mode=...`** -- causality. 14 modes spanning verifier internals (`mode=verifier <name>`), HCI regression (`mode=hci-drop`), KB structure (`mode=kb-graph` / `mode=kb-context <id>`), pre-edit prediction (`mode=predict <file>`), ground-truth signatures (`mode=conscience`), tensegrity-shape (`mode=fractal-shape`), and free-text retrieval (`mode=search` / `--deep`). Run `i/help why` for the full list.
- **`i/status timeline`** -- chronological audit trail of silent automations (auto-reload, KB drafts, fs_watcher events, hook firings) joined into one run-length-collapsed view. Default 30m window; `window=5m|1h` to narrow/widen.


## Autonomous Evolution Loop

The Stop hook implements the **ralph-loop pattern**: when `.claude/hme-evolver.local.md` exists, the Stop hook blocks session exit and injects the next evolution directive, creating an autonomous multi-round evolution cycle. The filename predates the retirement of the Evolver subagent and is kept for backward compatibility; the mechanism is now purely hook-driven.

### Setup

Create `.claude/hme-evolver.local.md` (gitignored):

```markdown

enabled: true
iteration: 1
max_iterations: 5
done_signal: "EVOLUTION COMPLETE"


Continue simultaneous synergistic evolution of src/, doc/, and HME.
Run npm run main after each round of changes. After a STABLE or EVOLVED pipeline,
auto-commit and move to the next evolution opportunity. When you have completed
all outstanding evolutions and the system is in a good state, output "EVOLUTION COMPLETE".
```

The loop drives until `max_iterations` is reached or `done_signal` appears in the transcript.

### Fields

| Field | Description |
--
| `enabled` | `true` to activate (set `false` to pause without deleting) |
| `iteration` | Auto-incremented by the hook -- do not set manually |
| `max_iterations` | Hard cap (0 = unlimited) |
| `done_signal` | String Claude outputs to signal completion |

The prompt body (everything after the second ``) is injected verbatim as the next user prompt.

**Note:** Hooks are registered in top-level `~/.claude/settings.json` and pick up edits at the next session start. The `HME@polychron-local` plugin has been retired -- no plugin cache refresh is required.

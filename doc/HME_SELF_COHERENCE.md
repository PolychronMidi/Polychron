# HME Self-Coherence

HME's substrate for self-observation. The **HME Coherence Index** (HCI) scores 67+ verifiers; the **holograph** snapshots full state for diff. Read this when you want to understand what HME measures about itself; read [HME.md](HME.md) for what HME currently does.

## The HCI

Source: [tools/HME/scripts/verify-coherence.py](../tools/HME/scripts/verify-coherence.py). 67 weighted verifiers across 7 subtags:

| Subtag | What it covers |
|---|---|
| **doc** | Documentation matches code reality. CLAUDE.md rules aren't silently violated. |
| **code** | Source can run. Decorator order, todowrite-hook nonblock, syntax. |
| **state** | Runtime state machines valid (states-sync, onboarding-flow, todo-store-schema). |
| **coverage** | Every declared interface points to real implementation; subagent routing correct. |
| **runtime** | Live services responsive; alerts honest; latency within baseline; detector not drifting. |
| **topology** | Cross-boundary structures declared (feedback-graph). |
| **interface-contract** | State-file ownership, tool-surface coverage, subagent-backends. |

Each verifier returns a `VerdictResult` (PASS/WARN/FAIL/SKIP/ERROR + score 0-1 + summary + details). Aggregate is weighted mean × 100.

```bash
python3 tools/HME/scripts/verify-coherence.py            # human report
python3 tools/HME/scripts/verify-coherence.py --json     # machine-readable
python3 tools/HME/scripts/verify-coherence.py --score    # integer only
```

The score also flows through `i/hme admin action=selftest` and `i/status mode=hci-by-subtag`.

### Reading the HCI

The aggregate has one meaning: **how much of HME's own self-observation surface is currently green?**

- **100** -- every measured dimension fully coherent
- **95-99** -- minor drift, mostly cosmetic
- **80-94** -- real drift in one or two dimensions; investigate the lowest verifier
- **50-79** -- multiple categories degraded; system noticeably broken
- **0-49** -- foundational failure; HME may not be safe to use

Pipeline integration fails the build below 80. Drill via `i/why mode=verifier <name>` for per-verifier source + history.

## The Holograph

Source: [tools/HME/scripts/snapshot-holograph.py](../tools/HME/scripts/snapshot-holograph.py)

Captures full HME state at one moment as machine-readable JSON: HCI report, onboarding state, tool surface census, hook surface, KB summary, pipeline verdict history, todo store, codebase metrics, git state, streak counters. Saved as `output/metrics/holograph/holograph-YYYYMMDD-HHMMSS.json` (~14KB).

Two snapshots can be diffed:

```bash
python3 tools/HME/scripts/snapshot-holograph.py --diff output/metrics/holograph/holograph-PRIOR.json
```

Diff filters timing/timestamp noise to focus on real state drift. Use for reproducibility verification, side-effect detection, or feeding historical state into HME for meta-learning.

## Adding a verifier

```python
class MyNewVerifier(Verifier):
    name = "my-thing"
    category = "code"  # or doc, state, coverage, runtime, topology
    weight = 1.0       # higher = more impact on aggregate

    def run(self) -> VerdictResult:
        if everything_is_fine:
            return _result(PASS, 1.0, "all clear")
        return _result(FAIL, 0.3, "found N problems", ["detail 1", "detail 2"])

REGISTRY.append(MyNewVerifier())
```

Run `verify-coherence.py` and the new dimension appears in the report immediately. Run `snapshot-holograph.py` and the next snapshot captures the new dimension.

## LIFESAVER no-dilution rule

LIFESAVER (the critical-error banner via `register_critical_failure()`, drained on every tool response) exists for one reason: to be **intolerable until the root cause is fixed**. It is pain by design.

1. **No cooldowns on LIFESAVER fires.** Rate-limiting hides severity.
2. **No deduplication, no throttling, no "seen this before" flags.** Every fire is fresh.
3. **A "false positive" LIFESAVER is itself a critical bug.** Fix the detector at the same urgency as the original. Silencing a false positive is worse than the false positive itself, because it dilutes every real alert that comes after.
4. **The only way to make LIFESAVER quieter is to fix the underlying condition.** Either fix the state (alert stops naturally) or fix the detector (false-positive stops naturally). Any other path -- cooldown, dedup, time-based guard, `_last_fired_at` timestamp, severity downgrade -- is **subversion** and must be reverted.

### Enforcement: `LifesaverIntegrityVerifier`

Weight 5.0 (enough to crater the HCI alone). Scans `register_critical_failure` call paths in `tools/HME/service/server/` for forbidden patterns near fire sites:

- `cooldown` identifier in scope
- `_last_*_alert` timestamp variable
- `dedupe` / `_suppress` / `alerted_set`
- Time-based guard (`if now - X >= N:`) immediately before `register_critical_failure`

PASS = LIFESAVER allowed to scream freely. FAIL = dampening introduced; HCI tanks until reverted.

### When LIFESAVER is loud

1. Read the alert.
2. Identify root cause (usually a sticky condition: slow tool response, degraded coherence, failing shim).
3. Fix the cause -- not the detector, not the alert.
4. LIFESAVER stops on its own.

If after fixing you believe the detector was wrong, that is itself a critical bug -- fix the detector's logic so it correctly distinguishes real from false. Do NOT add a cooldown.

### Calibration vs dampening (the line)

**Allowed -- detector calibration:**

- **Maturity gates** (e.g. health_topology coherence unreliable for first ~50 readings; gate alerts until threshold). Calibration: detector stops claiming knowledge it doesn't have.
- **Crash-vs-reconnect distinction** (e.g. restart_churn requires `(shim_crashes >= 2 OR recovery_failures >= 3)` as precondition, not bare `restarts >= 5`). Accuracy: detector distinguishes bad case from benign case.
- **Baseline-relative thresholds** (e.g. latency uses rolling per-machine median, fires only on 3× regression from baseline). Locality: detector distinguishes "slow for me" from "slower than I usually am."

**Forbidden -- alert dampening:**

- Time-based cooldowns (`if time.time() - last_fire >= 1800: ...`). Hides ongoing problems.
- Deduplication by event hash. Silences re-occurrences of the same condition.
- Severity downgrade (CRITICAL → INFO) for noise reasons. Allowed only when the condition itself is informational.

**Rule of thumb:** if your fix makes LIFESAVER quieter without changing whether the condition is present, it's dampening. If your fix makes LIFESAVER more accurate about when the condition is present (and quieter as a side-effect), it's calibration.

## The full stack

Implemented and wired into the pipeline.

### Infrastructure

- **Inference proxy** (`tools/HME/proxy/hme_proxy.js`): authoritative filter for all inference. Multi-upstream routing via `X-HME-Upstream` header. Emergency valve auto-clears with backoff escalation (60s → 120s → 300s → 600s).
- **Activity bridge** (`output/metrics/hme-activity.jsonl`): typed event stream. Emitters: hooks, proxy, `tools/HME/activity/emit.py`. Schema in `tools/HME/activity/EVENTS.md`.
- **Policy engine** (`scripts/pipeline/check-hme-coherence.js`): pre-composition pipeline step. Reads activity log, enforces coherence invariants, writes `output/metrics/hme-violations.json`.

### Self-awareness layer

| Step | Output | Knows |
|---|---|---|
| `build-kb-staleness-index` | `kb-staleness.json` | Which modules' KB entries are stale/missing |
| `check-kb-semantic-drift` | `hme-semantic-drift.json` | Where KB descriptions diverge from code reality |
| `compute-coherence-score` | `hme-coherence.json` | How grounded this round's evolution was in the KB |

### Self-assessment

| Step | Output | Measures |
|---|---|---|
| `generate-predictions` | `hme-predictions.jsonl` | Cascade impact predictions from dependency BFS |
| `reconcile-predictions` | `hme-prediction-accuracy.json` | Whether predictions matched actual fingerprint shifts |
| `compute-musical-correlation` | `hme-musical-correlation.json` | Whether HME coherence predicts musical quality |
| `compute-compositional-trajectory` | `hme-trajectory.json` | Whether musical complexity is growing/plateauing/declining |

### Self-governance

| Step | Output | Governs |
|---|---|---|
| `compute-coherence-budget` | `hme-coherence-budget.json` | Optimal coherence band -- too high = over-disciplined, too low = chaotic |
| `compute-kb-trust-weights` | `kb-trust-weights.json` | Epistemic reliability of each KB entry |
| `compute-intention-gap` | `hme-intention-gap.json` | What keeps getting proposed but not finished |
| `derive-constitution` | `hme-constitution.json` | Constitutional claims about what Polychron is |

### Meta-meta

| Step | Output | Produces |
|---|---|---|
| `detect-doc-drift` | `hme-doc-drift.json` | Where docs diverged from KB knowledge |
| `compute-evolution-priority` | `hme-evolution-priority.json` | Ranked next-change list from 9 signal sources |

### Compounding structure

These aren't independent features -- each feeds the next:

- Staleness → coherence score (stale-module writes penalized)
- Coherence score → budget (determines optimal band)
- Budget → proxy (gates injection behavior)
- Predictions → accuracy (scored against pipeline fingerprints)
- Accuracy → trust weights (low accuracy = lower trust for that KB region)
- Trust weights → proxy (high-trust as principles, low-trust as hypotheses)
- Constitution → doc drift (constitutional claims checked against documentation)
- All 9 signals → evolution priority (ranked self-direction)

System output at full expression: a ranked list of what HME thinks should change, derived from where its knowledge is wrong, where its predictions fail, where the music is stalling, and where the architecture has structural gaps nobody designed in.

## Four-arc framework (Phase 7)

Phases 1-6 produced seven independent observability substrates. Phase 7 made them interlock.

- **Arc I -- Cross-Substrate Consensus** (`scripts/pipeline/hme/compute-consensus.js`). Seven voters (hci / invariants / prediction_recall / verdict / axis_cost_trend / clap / listening_verdict) each produce scalar in [-1, +1]. Mean = consensus; stdev = divergence signal. `composition_reality_overrides_substrate_divergence` rule: when listening verdict = legendary for 3+ rounds AND HCI ≥ 95, divergence demoted to `low_override_by_reality`.
- **Arc II -- Pattern Registry** (`tools/HME/patterns/*.json`). Meta-patterns as declarative JSON: `trigger.check`, `action.steps`, `action.auto_apply` flag, instantiation history. Matcher at `scripts/pipeline/hme/match-patterns.py`. Auto-apply runs non-destructive action scripts automatically; destructive steps require agent.
- **Arc III -- Inverse Reasoning** (`scripts/pipeline/hme/compute-legendary-drift.py`). Snapshots 14 state dimensions per round into `output/metrics/hme-legendary-states.jsonl`. Envelope = exponentially-weighted (decay 0.85) median + stdev per field. Per-field z-score flags outliers; mean |z| is drift score. Fires BEFORE verdict fails.
- **Arc IV -- Meta-Measurement** (`scripts/pipeline/hme/compute-invariant-efficacy.py`). Classifies every invariant: load-bearing (cited + firing), load-bearing-historical (cited + passing), structural (existence checks), decorative (never fired / never cited), flappy (fires without citation). Retirement log at `output/metrics/hme-invariant-retirement-log.jsonl`.

### Emergent behaviors (not explicitly built)

1. Consensus synthesis (Arc I direct)
2. Pattern matching (Arc II direct)
3. Drift detection (Arc III direct)
4. Efficacy classification (Arc IV direct)
5. Action synthesis -- `propose-next-actions.py` reads all four arcs, produces prioritized queue at `output/metrics/hme-next-actions.json`. Empty queue = healthy quiescent state.
6. Auto-diagnosis -- `auto-investigate.py` runs read-only diagnostic steps for matched patterns; findings at `output/metrics/hme-investigation-reports.jsonl`.
7. Auto-apply -- matched patterns with `auto_apply: true` run their action script automatically.

### Arc-freeze discipline

`tools/HME/config/arc-freeze.json`: no new voters, patterns, invariants, or arc scripts for N pipeline runs. Thaws when (a) N runs elapse, (b) listening verdict changes, or (c) HCI drops <95 for 2+ consecutive rounds. Prevents substrate-self-iteration drift.

### Agent-facing tools

| Tool | Purpose |
|---|---|
| `i/status substrate [mode]` | Unified four-arc view. Modes: brief, detail, actions, drift, consensus, efficacy, patterns, diff |
| `i/why <invariant-id>` | Explain invariant's class, streak, commit citations, recent history |
| `i/why mode=freeze [query]` | Show arc-freeze marker; check query against forbidden list |
| `i/learn patterns [list\|matched\|<id>]` | Query pattern registry |

`userpromptsubmit.sh` auto-captures `listening verdict: X` from user messages → ground-truth entry (listening voter in Arc I becomes automatic). `posttooluse_bash.sh` auto-fires `i/review mode=forget` after git commits.

## Self-coherence probes

Selftest runs structural probes beyond the legacy verifier set:

| Probe | Catches |
|---|---|
| daemon uniqueness | More than one `llamacpp_daemon` visible to pgrep |
| llama-server count | More than 2 running (declared topology = arbiter + coder) |
| daemon thread hygiene | `Exception in thread` in recent daemon log = silent thread crash |
| GPU attribution | >200 MB VRAM used but not attributed to a declared process |
| single-writer registry | `_OWNERS` empty or module unimportable |
| invariant enforcement coverage | Every registered owner's source contains `assert_writer(<domain>, ...)` |
| version consistency | daemon + worker + canonical `versions.json` agree |
| meta-invariant coverage | Non-owner module calls protected mutation (`scripts/check-single-writer-coverage.py`) |
| HME dogfooding | HME's own Python obeys no-silent-catch rule (`scripts/check-hme-dogfooding.py`) |
| invariant genealogy | Share of invariants with `born_from` origin citation |
| temporal drift | Selftest result flips PASS→FAIL after ≥3 PASSes (from `hme-coherence-timeseries.jsonl`) |

Chaos verifiers at [scripts/chaos/](../scripts/chaos/) inject faults and assert the corresponding probe catches them. `run-all.sh` runs the full battery.

## Distilled principles (from R1-R29 build-out)

Lessons that survived the construction of this system. The chronological round-by-round narrative lived here previously; it's been distilled to the principles. Round-specific archeology lives in KB (search `i/learn query=<topic>`).

- **LIFESAVER stays painful.** Any cooldown / throttle / dedup / suppression near `register_critical_failure` is structural subversion. Caught by `LifesaverIntegrityVerifier` at weight 5.0.
- **Calibration ≠ dampening.** Maturity gates, crash-vs-reconnect distinctions, baseline-relative thresholds are calibration (allowed). Time-cooldowns, dedup-by-hash, severity-downgrade-for-noise are dampening (forbidden).
- **Source-based filters beat format-based filters.** Substring-matching message text (`"/reindex" in message`) drifts when message format changes; checking the explicit `source` argument doesn't. `TransientErrorFilterVerifier` enforces this.
- **Multi-window recency for "is X happening NOW" verifiers.** Acute (1h), medium (6h), recent (24h) buckets with weighted penalty. Acute dominates; stale events age out automatically.
- **Pipeline-owned observability.** The pipeline must produce its own telemetry, not depend on agent hooks. If the substrate depends on the agent to fire, the agent is the only thing visible.
- **Rationale comments lie, data doesn't.** Every "Candidate for removal" comment is a hypothesis waiting for instrumentation. R13/R15 retired or kept legacy overrides based on per-round fire counts; comment-driven intuition was wrong on 2 of 3 keepers.
- **The allowlist is a measurement output, not a compromise surface.** Every entry is either data-proven load-bearing or data-proven unused. No "probably needed" tier.
- **Composition reality overrides substrate divergence.** When listening verdict is legendary AND HCI ≥ 95, internal disagreement is academic. External ground truth is the tiebreaker.
- **Substrate navel-gazing is a real failure mode.** When every recent structural change is about the substrate itself rather than composition, the framework is built and further investment earns nothing until composition produces new signal. Arc-freeze discipline encodes this.
- **Detector locality, not absolute thresholds.** "10 seconds is bad" doesn't generalize across hardware. Rolling per-machine baselines + N× regression triggers do.
- **Subagent backend health must be a verifier.** Silent backend missing-ness (e.g. ripgrep not installed) produced zero-value subagent output for weeks. `SubagentBackendsVerifier` (weight 1.5) catches this in one HCI run.
- **Inverse-reasoning catches drift before verdict fails.** Snapshot N state dimensions per round, track per-field z-score against legendary-only envelope. Fires before composition itself fails.

## The principle

Every implicit assumption about HME's correctness should become an explicit, scored measurement that the system can observe in itself. Every drift should be detectable before it confuses an agent. Every fix should reinforce the pattern that catches the next instance.

The goal is not perfection -- it's **continuous observability of the system's distance from its own ideal state**, so we always know which way to walk.

This document will rot too. The verifier should catch that.

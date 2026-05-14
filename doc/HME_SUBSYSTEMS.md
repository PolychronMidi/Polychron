# HME Hooks Integration & Phase 1-6 Subsystems

> Detail for the 30 observability/governance subsystems built on the activity-bridge JSONL stream. Surfaced via `status(mode=<subsystem>)`. Linked from [HME.md](HME.md).

## Hooks Integration

All hooks live in `tools/HME/hooks/` as standalone scripts, registered in `hooks/hooks.json` (Claude Code plugin format). This keeps hook logic version-controlled, testable, and visible from the HME directory.

### Activity Bridge

Phase 1 of the openshell feature mapping (planning doc archived post-delivery). Hooks emit structured events into `output/metrics/hme-activity.jsonl` (gitignored, append-only). Every line is one JSON object: `{event, ts, session, ...}`. The shared writer is `tools/HME/activity/emit.py` -- a zero-dependency CLI invoked from bash hooks in the background.

| Event | Source | Agent-independent? | Fields |
| --- | --- | --- | --- |
| `edit_pending` | `pretooluse_edit.sh` (Claude Edit) | no -- Claude-only | file, module, hme_read_prior |
| `file_written` | `watcher.py` filesystem watcher + proxy middleware | **yes** -- any editor triggers it | file, module, hme_read_prior |
| `coherence_violation` | `posttooluse_edit.sh` | no -- Claude-only | file, module, reason |
| `pipeline_start` | `main-pipeline.js` | **yes** -- pipeline emits directly | session |
| `pipeline_run` | `main-pipeline.js` | **yes** -- pipeline emits directly | verdict, passed, wall_s, hci |
| `round_complete` | `main-pipeline.js` | **yes** -- pipeline emits directly | verdict, passed, session |
| `turn_complete` | `stop.sh` | no -- Claude-only | session |
| `inference_call` | `hme_proxy.js` | no -- proxy-routed only | model, messages, injected |

Query the stream via `status(mode='activity')` -- surfaces event counts, coherence ratio (writes with vs. without prior HME read), pipeline runs, and recent writes. Window defaults to "round" (events since last `round_complete`).

The bridge is additive: no state is kept outside the JSONL itself, and `activity_digest.py` reads the tail lazily. Phases 2 and 3 share this event stream.

### Inference Proxy

Phase 2 of the feature mapping. `tools/HME/proxy/hme_proxy.js` is a Node.js HTTP chokepoint between Claude Code and the Anthropic API. Point Claude Code at it by setting `ANTHROPIC_BASE_URL=http://127.0.0.1:9099` and launching `node tools/HME/proxy/hme_proxy.js`.

Every request is scanned stateless-ly: the full `messages` array is walked for `tool_use` blocks and write-bearing tool calls (`Edit`, `Write`, `NotebookEdit`). Every call emits one `inference_call` event into `output/metrics/hme-activity.jsonl`.

The legacy `write_without_hme_read` / `inference_write_without_hme_read` detection was retired (Apr 2026). It enforced a legacy-MCP contract ("did the agent explicitly invoke `HME_read` before Edit?") that no longer maps to the architecture -- every `Edit` / `Read` tool_result is auto-enriched with KB context by the `edit_context.js` / `read_context.js` / `dir_context.js` middleware. The detector was firing false positives on 100% of edits; check-hme-coherence was aborting the pipeline over 200+ false violations per round.

Streaming SSE responses pipe through verbatim -- no buffering, no latency penalty. The proxy never modifies request bodies in v1 (observability only). System-prompt injection is deliberately deferred to a future phase so the observation signal can be validated in isolation.

Test mode: `node tools/HME/proxy/hme_proxy.js --test < payload.json` prints the scan result and exits non-zero on violation. Used by unit tests without spinning up a listener.

### Pipeline Policy Gate

Phase 3 of the feature mapping. `scripts/pipeline/check-hme-coherence.js` runs as a PRE_COMPOSITION step in `main-pipeline.js` (after `check-registration-coherence`, before `check-safe-preboot-audit`). It reads the activity stream, slices to the current round (events since the last `round_complete`), and fails the pipeline if any `coherence_violation` events fired.

As of Apr 2026, the `write_without_hme_read` variant of `coherence_violation` is no longer emitted (see "Inference Proxy" above for rationale). `productive_incoherence` events still fire for exploratory writes into KB-uncovered modules -- those are suggestion signal, not violations, and do not fail the pipeline.

Output: `output/metrics/hme-violations.json` -- a full audit record with meta (window size, write coverage %), violations array (split by hook vs proxy source), and ISO timestamps. Picked up by `posttooluse_bash.sh`'s LIFESAVER scanner when the pipeline completes.

### KB Staleness Index

Phase 2.2 of the feature mapping. `scripts/pipeline/build-kb-staleness-index.py` runs as a POST_COMPOSITION step, cross-references KB entry timestamps (lance `knowledge` table) against source-file mtimes and `file_written` events from the activity bridge, and writes `output/metrics/kb-staleness.json`. Every module lands in one of three buckets:

- **FRESH** -- most recent KB entry touching the module is newer than (or within `HME_STALENESS_STALE_DAYS`, default 7d, of) the last file write.
- **STALE** -- module has KB coverage but edits have outpaced it by > threshold.
- **MISSING** -- no KB entry mentions the module at all.

Surfaced via `status(mode='staleness')`. Read by the inference proxy at request time to annotate jurisdiction injections (see below) and by the coherence-score computer.

Matching uses word-boundary regex on title/tags (primary) and content (only for stems >=6 chars), so short names like "Motif" don't over-match generic prose.

### Round Coherence Score

Phase 2.3 of the feature mapping. `scripts/pipeline/compute-coherence-score.js` computes a single 0..100 metric per round from three components:

```
coherence_score = read_coverage * violation_penalty * staleness_penalty
```

- `read_coverage` = `file_written` events with `hme_read_prior=true` / total writes
- `violation_penalty` = `max(0, 1 - violation_count * 0.1)`
- `staleness_penalty` = 1 - (touches on STALE/MISSING modules / touches with index info)

Output: `output/metrics/hme-coherence.json` with score, delta vs previous round, and per-component breakdown. Surfaced via `status(mode='coherence')`.

### Blind-Spot Surfacing

Phase 2.4 of the feature mapping. `tools_analysis/blindspots.py` walks the full activity-bridge history, splits events into closed rounds at each `round_complete`, and over the last N rounds (default 10, `HME_BLINDSPOT_WINDOW` env var) computes three coverage gaps:

- Subsystems (utils/conductor/rhythm/time/composers/fx/crossLayer/writer/play) with zero `file_written` events in the window
- Modules written chronically without a prior HME read (>=2 occurrences)
- Touched modules that have no KB coverage at all (cross-reference with the staleness index)

Surfaced via `status(mode='blindspots')`. Factual coverage data, not a critique -- the decision about whether to rotate attention remains the agent's.

### Causal Cascade Indexing

Phase 2.5 of the feature mapping. `tools_analysis/cascade_analysis.py` merges `output/metrics/dependency-graph.json`, `output/metrics/feedback_graph.json`, and node provides/consumes registries into a forward BFS that answers *"if I change X, what does that trigger?"*.

Invoked via `trace(target='moduleName', mode='impact')`. Returns:

- Forward impact chain at depth 1..3 (file-level, with the global name bridging each edge)
- Blast-radius histogram grouped by subsystem
- Feedback loops the module participates in
- Firewall ports it touches
- Top reverse callers (1 hop) for centrality context

Also exposes `cascade_summary(target)` as a compact dict for the inference proxy to consume on hot paths.

### Real-Time Jurisdiction Injection

Phase 2.1 of the feature mapping, landing inside the inference proxy. On every request the proxy extracts the `file_path` / `path` / `target` field from every write-bearing tool_use block in the most recent assistant turn, then checks whether the target falls inside a tracked zone (`src/conductor/signal/meta/`, `src/conductor/signal/profiling/`) **or** matches any file in the 93-entry bias bounds manifest (`scripts/pipeline/bias-bounds-manifest.json`). Phase 3 extended the detection to also trigger on modules with **open hypotheses** (Phase 3.1) or **semantic drift warnings** (Phase 3.3).

If any target matches, the proxy builds a structured jurisdiction block containing:

- Zone tag (if the file is inside a controller authority boundary)
- Every locked bias registration for that file with exact `[lo, hi]` bounds
- KB staleness status for the module (FRESH/STALE/MISSING, delta days, match count)
- **Open hypotheses** whose `modules` list includes this file (id, claim, falsifier)
- **Semantic drift warning** if the module's structural signature has diverged from its KB baseline
- Remediation commands for re-snapshotting stale bounds and re-capturing drifted signatures

The block is appended to `payload.system` (supports both the string and array-of-content-blocks forms) before upstream dispatch. `Content-Length` is recomputed. An `injected=true` flag is attached to the `inference_call` activity event, and a separate `jurisdiction_inject` event is emitted so the activity digest and pipeline gate can observe how often injection fires.

Set `HME_PROXY_INJECT=0` to disable injection and run the proxy in pure observability mode. Default is on.

### Hypothesis Lifecycle Registry

Phase 3.1 of the feature mapping. Every causal claim the Evolver makes about the system gets a first-class machine-queryable record in `output/metrics/hme-hypotheses.json` -- proposer round, claim, **falsification criterion**, list of rounds in which the hypothesis was tested, status (OPEN/CONFIRMED/REFUTED/INCONCLUSIVE/ABANDONED), and the modules it applies to.

CRUD via the existing `learn` tool (no new top-level tool):

- `learn(action='hypothesize', title=CLAIM, content=FALSIFIER, tags=[modules], query=ROUND, listening_notes=evidence)` -- register
- `learn(action='hypothesis_test', remove=ID, content=VERDICT, query=ROUND, listening_notes=evidence)` -- record a test
- `learn(action='hypotheses')` or `status(mode='hypotheses')` -- list all, grouped by status

The proxy loads OPEN hypotheses at request time and injects them for any write target whose module appears in a hypothesis's modules list -- so the Evolver sees relevant standing claims before it makes an edit that might confirm or refute them.

### Productive Incoherence Detection

Phase 3.2 of the feature mapping. The coherence score previously penalized every write-without-HME-read equally. `posttooluse_edit.sh` cross-references the KB staleness index at emit time and emits:

- **Productive incoherence** -- module has MISSING KB coverage, so there was nothing meaningful to read first. Emits `productive_incoherence` (rewarded) plus a `learn_suggested` hint for the Evolver to capture findings afterward.

The companion "lazy violation" branch (FRESH-coverage + no read-before) was retired with the rest of the `write_without_hme_read` detector -- auto-enrichment middleware covers that case without needing a manual read. `productive_incoherence` survives because the MISSING-coverage signal is genuinely useful (suggests `learn()`) rather than a false-alarm source.

`compute-coherence-score.js` gains an `exploration_bonus` term:

```
score = read_coverage * violation_penalty * staleness_penalty * exploration_bonus
exploration_bonus = 1 + min(0.2, productive_incoherence_count * 0.05)
```

A round with 4+ productive explorations can gain up to +20% on top of the base score. Keeps HME disciplined in well-understood territory while actively rewarding the Evolver for pushing into uncharted ground.

### KB Semantic Drift Verification

Phase 3.3 of the feature mapping. Staleness says "the file was edited after the KB entry". Drift says "even if the KB entry is recent, the module's structural relationships have shifted enough that the description is likely wrong". Two scripts implement this:

- `scripts/pipeline/capture-kb-signatures.py` -- bootstraps/refreshes `output/metrics/kb-signatures.json`. For every KB entry, picks a candidate module (from title -> tags -> content), then computes a mechanical structural signature: caller count (from dependency graph), provides/consumes globals, bias registration keys, firewall ports, L0 channel reads/writes, content hash prefix. Captured at learn time; re-run to refresh baselines.

- `scripts/pipeline/check-kb-semantic-drift.py` -- runs every pipeline. Re-derives each module's current signature and diffs against the baseline. Entries with >=2 structural differences (tunable via `HME_DRIFT_THRESHOLD`) are flagged in `output/metrics/hme-semantic-drift.json`. Surfaced via `status(mode='drift')`.

Parallel signature index, not an extension to the lance schema -- works without touching existing KB entries.

### Prediction Accuracy Scoring

Phase 3.4 of the feature mapping. Every time `trace(target, mode='impact')` runs (either manually or via proxy injection), the cascade analyzer appends a prediction record to `output/metrics/hme-predictions.jsonl` containing the target module and the list of predicted affected modules (BFS depth 2 forward reach).

A post-composition reconciler (`scripts/pipeline/reconcile-predictions.js`) reads the log + `output/metrics/fingerprint-comparison.json` after the pipeline, then classifies each prediction:

- **Confirmed** -- predicted module appears in the fingerprint delta
- **Refuted** -- predicted but didn't shift
- **Missed** -- shifted but was not in any prediction

Computes per-round accuracy + an exponential moving average (alpha=0.2) across 50 rounds into `output/metrics/hme-prediction-accuracy.json`. Surfaced via `status(mode='accuracy')`.

Rising EMA = HME's causal model is learning. Falling EMA = predictions diverging from reality, which is a stronger signal than staleness alone (staleness says a file changed, low accuracy says HME's understanding of what the file *does* is wrong).

### Pattern Crystallization

Phase 3.5 of the feature mapping. `tools_analysis/crystallizer.py` scans the KB every pipeline for multi-round patterns: groups entries by substantive tag membership (metadata tags like `legendary`/`stable`/`bugfix` blacklisted), then for each tag pools all `R\d+` round references from member content. Clusters with >=3 members across >=3 distinct rounds qualify as crystallized patterns and land in `output/metrics/hme-crystallized.json`.

Each pattern record includes: shared tags (strict intersection of member tag sets), pooled round list, synthesis (first sentence of the most recent member), and member KB entry ids for traceability.

Run on demand: `learn(action='crystallize')`. Read: `status(mode='crystallized')`.

Rule-based in v1 -- no LLM synthesis. First run promoted 19 patterns from 116 entries (`emergentMelodicEngine` 8 members * 8 rounds, `antagonism-bridge` 6 * 7, `melodic-coupling` 6 * 6, etc.) -- exactly the standing principles the Evolver previously had to reconstruct from journal archaeology each session.

### Musical Ground Truth Correlation

Phase 4.1 of the feature mapping -- **the external anchor**. Every previous HME metric (coherence, prediction accuracy, staleness, drift, crystallization) is internally circular. `scripts/pipeline/compute-musical-correlation.js` runs post-composition to correlate HME's self-assessment signals against the actual musical output the pipeline produced:

- `hme_coherence` vs `fingerprint_verdict` (numeric: STABLE=1, EVOLVED=1.1, DRIFTED=0)
- `hme_coherence` vs `perceptual_complexity_avg` (EnCodec section tension)
- `hme_coherence` vs `clap_tension` (CLAP query peak)
- same triplet for `hme_prediction_accuracy`

Computes rolling-window Pearson correlation over the last 20 rounds, keeps 60 rounds of history in `output/metrics/hme-musical-correlation.json`. If the strongest correlation drops below 0.2 over >=5 points, emits a FATAL warning: HME's self-model has decoupled from musical outcomes and is optimizing its own metrics without that optimization translating to emergence.

Surfaced via `status(mode='music_truth')`. The correlation trend is the ultimate validator for the entire HME architecture -- a perfectly coherent HME that produces musically incoherent compositions has optimized the wrong thing entirely.

### Trust-Weighted KB

Phase 4.2 of the feature mapping. Every KB entry gains an epistemic trust weight derived from the round it was written in:

```
trust = 0.4 * coherence_at_write
      + 0.3 * accuracy_at_write
      + 0.2 * verdict_bonus
      + 0.1 * age_decay
```

`scripts/pipeline/compute-kb-trust-weights.py` matches each entry's timestamp against the musical-correlation and prediction-accuracy histories (within 14 days), falling back to a 0.5 uniform prior when history is too sparse or distant. Tiers: HIGH >= 0.75, MED >= 0.5, LOW < 0.5. Requires >=3 history points before history-derived components activate (otherwise a single degenerate round would drag every entry's trust to the floor).

Output: `output/metrics/kb-trust-weights.json` keyed by entry id with trust score, tier, and per-component breakdown. Parallel index -- no modifications to the lance schema.

Surfaced via `status(mode='kb_trust')`. The proxy reads this file at injection time and labels injected entries by tier so the Evolver sees *how well HME knows something*, not just *what HME knows*.

### Intention-Execution Gap Tracking

Phase 4.3 of the feature mapping. `scripts/pipeline/compute-intention-gap.js` reads the HME todo store (`tools/HME/KB/todos.json`) and cross-references each todo against `file_written` events from the activity bridge. Every trackable todo lands in one of three buckets:

- **fully_executed** -- status=completed+done=true AND at least one file/module mentioned in the todo text appears in the round's write events
- **partially_executed** -- status=completed but none of the expected targets were actually written
- **abandoned** -- status=pending/in_progress at round end, with at least one trackable target

Untrackable todos (completed with no file references) are dropped from the gap metric.

Improvement vs doc: doc proposed parsing proposed evolutions out of the prose journal. The todo store gives the same signal in clean JSON form -- no fuzzy text parsing. Every todo already has `text`, `status`, `done`, `ts`.

Rolling 30-round EMA in `output/metrics/hme-intention-gap.json`. Surfaced via `status(mode='intention_gap')`. Over many rounds, structural patterns emerge -- certain subsystems consistently proposed-but-not-executed (blind spots with extra friction), certain file combinations consistently partial (boundary complexity underestimated).

### HME Self-Audit

Phase 4.4 of the feature mapping. `tools_analysis/self_audit.py` queries three utility signals and surfaces architectural inefficiencies as *evolution candidates*:

1. **KB category usage** -- categories with >=15 entries and zero retrievals (UNUSED), or >=10 entries with retrievals < entries/10 (UNDER_QUERIED)
2. **Silent injections** -- proxy `jurisdiction_inject` events not followed by native Read/Edit enrichment in the same session before `round_complete`
3. **Cascade overconfidence** -- prediction-accuracy EMA < 0.5 over >=5 rounds

Data sources: `tools/HME/KB/knowledge_access.json`, `output/metrics/hme-activity.jsonl`, `output/metrics/hme-prediction-accuracy.json`. Read-only -- never modifies anything, just reports.

Surfaced via `status(mode='self_audit')`. This is the first step toward HME being subject to the same "structural over parametric" and "never delete -- implement" laws that govern Polychron itself: when HME identifies a part of its own architecture that isn't working, that becomes an evolution candidate alongside Polychron candidates in Phase 3 selection.

### Adversarial Self-Probing

Phase 4.5 of the feature mapping. `tools_analysis/probe.py` generates *candidate* probes -- deliberately boundary-pushing evolution proposals targeting modules where HME's current model is most likely to be wrong.

Candidates are drawn from the intersection of:

1. **Subsystem intersection modules** -- modules whose forward edges cross >=3 distinct subsystems (from the dependency graph). These are structural intersection points where cascade confidence is most likely mis-calibrated.
2. **KB trust gaps** -- modules with NONE or LOW trust-tier KB coverage (score multiplier *2).
3. **Cascade accuracy** -- if the prediction-accuracy EMA is unknown or below 0.5, everything gets a *2 multiplier because the cascade model itself is suspect.

For each candidate, the probe carries a predicted cascade summary (depth-2 forward reach, direct callers, feedback loops) and a predicted_confidence tier. The agent runs the probe in a lab sketch (never `main`), observes the actual outcome, and feeds the delta back into HME's trust weights and cascade model.

Surfaced via `status(mode='probes')`. This module never *runs* a probe -- it produces candidates and lets the agent decide which to execute. Controlled failure is more epistemically valuable than repeated success in familiar territory; the probe mechanism gives HME a way to actively stress-test its own model rather than waiting for the agent to accidentally discover blind spots.

### Compositional Trajectory

Phase 5.1 of the feature mapping. `scripts/pipeline/compute-compositional-trajectory.js` fits a linear trend to the last 20 rounds of perceptual signals from `output/metrics/hme-musical-correlation.json`:

- `perceptual_complexity_avg` -- average EnCodec section tension
- `clap_tension` -- CLAP tension-query peak similarity
- `encodec_entropy_avg` -- mean codebook entropy

Per-signal slope is classified GROWING / PLATEAU / DECLINING against a per-signal threshold. Overall verdict is a majority vote with PLATEAU as the conservative tiebreaker.

Output: `output/metrics/hme-trajectory.json` with per-signal slope/intercept/variance and a rolling 60-round verdict history. Surfaced via `status(mode='trajectory')`. Feeds the coherence budget -- when the trajectory shows PLATEAU or DECLINING, HME's guidance shifts toward structural novelty regardless of how well individual rounds are executed.

### Coherence Budget (Homeostatic Governance)

Phase 5.2 of the feature mapping -- **the inversion point**. The previous phases all optimized HME toward more discipline. This one recognizes that maximum discipline may suppress the productive chaos that generates musical emergence -- and instead *calibrates* coherence to an optimal band derived from history.

`scripts/pipeline/compute-coherence-budget.js` algorithm:

1. Read musical-correlation history and compute each round's composite musical-outcome score (`0.5 * perceptual_complexity + 0.3 * clap_tension + 0.2 * verdict_numeric`).
2. Take the top quartile of rounds by outcome -- "the good rounds".
3. The optimal coherence band = [25th, 75th] percentile of `hme_coherence` values in those good rounds.
4. If history has <8 rounds, use a prior band of [0.55, 0.85].
5. Classify current coherence as BELOW / OPTIMAL / ABOVE the band and emit a prescription:
   - **BELOW**: TIGHTEN -- proxy injects forcefully (full KB context + bias bounds + open hypotheses)
   - **OPTIMAL**: NORMAL injection
   - **ABOVE**: RELAX -- proxy skips non-critical warnings, allows writes into low-coverage territory without emitting `coherence_violation`, flags the round as "emergence-licensed"

Output: `output/metrics/hme-coherence-budget.json` with band, current state, and prescription. Surfaced via `status(mode='budget')`. Stops maximizing coherence and starts *governing* it homeostatically -- the same pattern Polychron's own conductors use for density, tension, and flicker.

### Architectural Negative Space Discovery

Phase 5.3 of the feature mapping. `tools_analysis/negative_space.py` finds structural gaps in Polychron's topology that aren't blind spots (the Evolver never considered them) but genuine theoretical absences the system's own structure predicts.

Two mechanical detectors (v1 deliberately avoids semantic similarity):

1. **Feedback loop near-misses** -- for each registered feedback loop, compute the set of modules whose dependency-graph edges touch >=⌊|loop|/2⌋ of the loop's participants but aren't themselves registered in the loop. Universal infrastructure modules (those with producer fan-out >=30) are filtered out so `validator`/`clamps`/`index` don't dominate. Top candidate on first run: `stutterVariants -> entropy-regulator` at 1.0 confidence (3/3 participants touched, not in loop).
2. **Co-consumed orphan pairs** -- module pairs imported together by >=5 shared consumers (excluding universal modules) with no direct producer->consumer edge between them. The architecture treats them as functionally related without explicit wiring. Top result: `stutterNotes <-> stutterVariants` (20 shared consumers).

Surfaced via `status(mode='negative_space')`. These become first-class evolution candidates that the agent didn't have to think of -- they emerge from HME's structural model of the system.

### Cognitive Load Modeling

Phase 5.4 of the feature mapping. HME models Polychron's architecture and its own KB. This module adds a model of the agent running the loop.

`tools_analysis/cognitive_load.py` walks the activity bridge and computes per-closed-round load signatures: total tool calls, file writes, edit pendings. Maintains a rolling distribution and classifies the current session:

- **LOW** -- tool_calls below p50 of historical workload
- **MEDIUM** -- tool_calls above p50
- **MEDIUM_HIGH** -- tool_calls and file_writes both above p75
- **HIGH** -- tool_calls above p90 (top decile of workloads)

Output: `output/metrics/hme-cognitive-load.json` with current signature, historical distribution, and load level. Surfaced via `status(mode='cognitive_load')`. Needs >=5 closed rounds before percentile classification activates.

### Reflexivity Model -- Injected vs Clean Predictions

Phase 6.1 of the feature mapping. HME's prediction accuracy scores have been contaminated by HME's own injections: when the cascade indexer predicts that editing X will affect Y and Z, and the proxy surfaces that prediction to the Evolver before the edit, the resulting "confirmation" is partly self-fulfilling -- the Evolver knew the prediction and acted on it.

Fix: every `cascade_prediction` record carries an `injected: bool` flag. `reconcile-predictions.js` splits predictions into two buckets:

- **Clean bucket** -- predictions made post-hoc with no injection influence. True accuracy test of the cascade model.
- **Injected bucket** -- predictions the Evolver saw before acting. Measures *influence*, not *accuracy*.

A `reflexivity_ratio` per round records what fraction of predicted modules came from injected predictions. High injected-bucket confirmation but flat clean-bucket accuracy means HME is changing what the Evolver does without actually predicting better -- influence without understanding. Surfaced via `status(mode='reflexivity')`.

### Constitutional Identity Layer

Phase 6.2 of the feature mapping. CLAUDE.md says what Polychron *can't be* (prohibitions). `output/metrics/hme-constitution.json` says what Polychron *fundamentally IS* (positive affirmations).

`scripts/pipeline/derive-constitution.py` extracts constitutional claims from three evidence sources:

1. **Structural** -- every feedback loop and firewall port in `output/metrics/feedback_graph.json` is an architectural invariant. All confidence 1.0.
2. **Methodological** -- crystallized patterns with >=4 rounds and >=3 members become standing architectural fixtures. Confidence scales with evidence breadth.
3. **Musical** -- human ground truth entries with compelling/surprising/moving sentiment, grouped by (section, moment_type). Confidence scales with record count.

Each claim carries an evidence trail: rounds, pattern ids, ground-truth ids. Surfaced via `status(mode='constitution')`. First run produced **37 claims**: 20 structural + 16 methodological + 1 musical from 19 crystallized patterns and 1 ground-truth entry.

The distinction between rules and identity is the one that allows genuine evolution rather than endless constraint accumulation.

### Doc Drift Detection

Phase 6.3 of the feature mapping -- living documentation as detection, not auto-generation. `scripts/pipeline/detect-doc-drift.py` cross-references the KB's architectural claims against the hand-maintained docs:

- KB entries referencing modules that no longer exist in `src/`
- Backtick-fenced module-name tokens in ARCHITECTURE.md / SUBSYSTEMS.md / HME.md / TUNING_MAP.md / CLAUDE.md that don't resolve to a source file
- Hard rules that have generated >=5 productive_incoherence events (blocking exploration -- refinement candidate)
- Hard rules with zero coherence_violation events over >=10 closed rounds (consistently honored -- constitutional promotion candidate)

Output: `output/metrics/hme-doc-drift.json`. v1 is deliberately noisy -- checks only backtick-fenced tokens to avoid false positives from natural English. Surfaced via `status(mode='doc_drift')`. DETECTION signal only; human review required before claiming any doc change.

### Generalization Extraction

Phase 6.4 of the feature mapping, rewritten in R97 after the original pipeline produced 3063 lines of LLM-generated tautology before the user demanded a rebuild.

**Pipeline** (three steps, runs every `npm run main`):

1. [`extract-generalizations.py`](../scripts/pipeline/hme/extract-generalizations.py) scores every crystallized pattern on `project_specificity`: the fraction of camelCase-split tokens in tags + synthesis that match a **dynamically-built** project vocabulary (bias-bounds manifest + L0 channel names + subsystem directory names + hand-curated seeds). Tokens like `emergentMelodicEngine` now score high where the old hardcoded-list version scored 0.00. Patterns below threshold 0.3 become candidates. Writes `metrics/hme-generalizations.json`.

2. [`synthesize-generalizations.py`](../scripts/pipeline/hme/synthesize-generalizations.py) sends each candidate through the **free-tier reasoning API cascade** (Groq -> Cerebras -> Mistral -> NVIDIA -> OpenRouter -> local arbiter fallback) -- NOT the 4GB local arbiter that produced vague waffle. The prompt demands three structured fields: **invariant**, **falsifiable prediction for similar systems**, **counterexample that would disprove it**. Anything missing a field is rejected as tautology (`REJECT` or missing-label).

3. **Novelty + stability gates** (enforced by step 2): a new draft whose invariant matches any existing one at cosine-similarity >=0.90 is dropped as duplicate. A draft whose text survives >=3 consecutive runs unchanged flips `promotable=true`.

**Human-curated promotion** -- only the user can move a draft from jsonl into the permanent record:

- `learn(action='discoveries')` -- list drafts with stability + promotable flag.

Surfaced also via `status(mode='generalizations')`.

### Multi-Agent Observability Scaffold

Phase 6.5 of the feature mapping. HME can't unilaterally split the Evolver into Perceiver / Proposer / Implementer agents -- that's a process-level decision outside HME's jurisdiction. What HME provides is the scaffold so that IF the loop is run multi-agent, HME tracks inter-agent coherence.

Activity events gain an optional `role` field (perceiver / proposer / implementer / single). Hypotheses and todos gain an optional `agent_role` tag. `tools_analysis/multi_agent.py` computes:

- **perceiver -> proposer coherence** -- fraction of proposer-role hypotheses that share modules with recent perceiver-role activity
- **proposer -> implementer coherence** -- fraction of implementer-role file_written events targeting modules mentioned in proposer-role todos/hypotheses

When all events carry `role=single`, inter-agent coherence is N/A -- single-agent operation isn't broken, it just can't be scored against the multi-agent ideal. Surfaced via `status(mode='multi_agent')`.

### Human Ground Truth -- The Grounding Anchor

Phase 5.5 of the feature mapping -- the answer to the circularity problem. Every HME metric eventually grounds out in HME's own outputs. Musical correlation was a partial external anchor but EnCodec and CLAP measure audio features, not musical meaning. The only complete anchor is a human listener finding the composition genuinely moving.

`tools_analysis/ground_truth.py` makes human feedback a first-class HME signal:

```
learn(action='ground_truth',
      title=SECTION,              # S0..S6 or 'all'
      tags=[moment_type, sentiment],
      content=COMMENT,
      query=round_tag)
```

Records land in two places:
1. `output/metrics/hme-ground-truth.jsonl` -- append-only stream keyed by timestamp
2. The KB via `add_knowledge`, tagged `human_ground_truth`, category `decision`

**Trust override**: `compute-kb-trust-weights.py` detects the `human_ground_truth` tag and unconditionally assigns tier HIGH (trust=1.0). When an HME prediction conflicts with a ground-truth entry, the ground-truth wins and the conflict is surfaced. HME can be as sophisticated as it becomes, but the ultimate coherence validator is whether a human finds the music meaningful -- and the system should never be able to optimize its way around that.

Surfaced via `status(mode='ground_truth')`.

### Hook Scripts (22 hooks across 7 lifecycle events)

All hooks share `_tab_helpers.sh` for deduped tab operations and `_safety.sh` for weighted streak counter (`_streak_tick WEIGHT` / `_streak_check` / `_streak_reset`) and HME HTTP enrichment helpers (`_hme_enrich` / `_hme_validate` / `_hme_kb_count` / `_hme_kb_titles`). Streak weights: Read=5, Edit=10, Write=10, Bash=15, Grep=20. Warns at 50, blocks at 70.

| Script | Event | Matcher | What It Does |
--
| `sessionstart.sh` | SessionStart | * | Reset compact tab, capture previous session's nexus pending state before reset, inject HME awareness (pipeline verdict + wall time, last journal round, uncommitted changes, last commit), surface previous session unfinished items |
| `pretooluse_read.sh` | PreToolUse | Read | Block polling of task output files; **enrich** project source reads with KB titles via `systemMessage` (Read proceeds + KB injected, no extra turn) |
| `pretooluse_edit.sh` | PreToolUse | Edit | Surface live KB constraint warnings via shim for all project files; remind `read(mode="before")`; **emit `edit_pending`** activity event |
| `pretooluse_grep.sh` | PreToolUse | Grep | Surface live KB relevance via shim (titles only); multiline exempt |
| `pretooluse_write.sh` | PreToolUse | Write | Block memory writes, detect secrets, lab rules for `sketches.js` |
| `pretooluse_bash.sh` | PreToolUse | Bash | Block `rm run.lock`, anti-polling, anti-wait, FAILFAST enforcement; **correct** timeout via `updatedInput` (strips timeout silently, command proceeds) |
| `pretooluse_todowrite.sh` | PreToolUse | TodoWrite | **Correct/enrich in place** -- merges native tasks with the HME todo store and returns `updatedInput`; native TodoWrite still runs |
| `pretooluse_hme_primer.sh` | PreToolUse | Bash (dispatched by pretooluse_bash.sh on `i/<hme-tool>`) | **Enrich** -- inject `templates/ONBOARDING.md` once per session via `systemMessage` on first HME tool call; appends mandatory boot check directive (run `i/hme admin action=selftest` + `i/evolve focus=invariants`); clears flag so it only fires once |
| `pretooluse_check_pipeline.sh` | PreToolUse | Bash (dispatched by pretooluse_bash.sh on `i/status`) | **Redirect** -- deny repeated status calls (polling anti-pattern); pipeline status surfaces automatically via posttooluse hook |
| `pretooluse_agent.sh` | PreToolUse | Agent | **Intercept** Explore-type subagents -> route to local llama.cpp agentic loop with RAG+KB context; other agent types pass through; falls back to Claude on llama.cpp unreachable or empty answer |
| `log-tool-call.sh` | PostToolUse | * | Log every tool to `session-transcript.jsonl` + shim; **LIFESAVER**: detect HME calls (`Bash(i/<hme-tool>)` or legacy `mcp__HME__*`) and warn to stderr on 15-30s threshold |
| `posttooluse_bash.sh` | PostToolUse | Bash | Track background output files to tab + Evolver phase triggers (verdict + wall time in header) + **LIFESAVER**: scan pipeline-summary.json for error patterns after `npm run main`; **emit `pipeline_run`** activity event with verdict/wall/hci |
| `posttooluse_pipeline_kb.sh` | PostToolUse | Bash | Append `KB:` trace summary to tab after `npm run main` |
| `posttooluse_read_kb.sh` | PostToolUse | Read | Silent KB enrichment after file reads of project source files; reset streak |
| `posttooluse_todowrite.sh` | PostToolUse | TodoWrite | Mirror high-priority native todos back to the HME todo store so critical items persist across turns |
| `pretooluse_toolsearch.sh` | PreToolUse | ToolSearch | Guard against tool-search polling; enrich with KB tool-surface context for the search query |
| `posttooluse_edit.sh` | PostToolUse | Edit | Track edited src/HME files to NEXUS backlog; warn when backlog >= 3/5 files; **emit `file_written`** + **split into `coherence_violation` (lazy) vs `productive_incoherence` (exploratory)** using the KB staleness index |
| `posttooluse_write.sh` | PostToolUse | Write | Track `.md`/`.txt` note files (outside `tmp/`) to tab |
| `posttooluse_agent.sh` | PostToolUse | Agent | Track subagent background output files to tab |
| `posttooluse_read_kb.sh` | PostToolUse | Read | Track briefed files to NEXUS; reset streak |
| `posttooluse_hme_review.sh` | PostToolUse | Bash (dispatched by posttooluse_bash.sh on `i/review`) | Clear NEXUS edit backlog on `mode=forget`; point to next step (pipeline / commit) |
| `posttooluse_addknowledge.sh` | PostToolUse | Bash (dispatched by posttooluse_bash.sh on `i/learn`) | Clear `KB:` entries from tab after `i/learn title=... content=...` add call |
| `userpromptsubmit.sh` | UserPromptSubmit | * | Inject Evolver context on evolution-related prompts |
| `precompact.sh` | PreCompact | * | Surface `KB:`/`FILE:` entries from tab + untracked `tmp/` files |
| `postcompact.sh` | PostCompact | * | Re-surface the same tab state after compaction |
| `stop.sh` | Stop | * | Verify all work is implemented in code, not just documented; **emit `round_complete`** activity event |

### Adding a New Hook

1. Create `tools/HME/hooks/your_hook.sh` (read JSON from stdin, write hookSpecificOutput JSON to stdout, exit 0)
2. Add entry to `hooks/hooks.json` with `${CLAUDE_PLUGIN_ROOT}/hooks/your_hook.sh`
3. Document in this table

### Bash-gate <-> JS-policy unification

When adding a bash gate that has a JS-policy counterpart in [tools/HME/policies/builtin/](../tools/HME/policies/builtin/), source [hooks/helpers/_policy_enabled.sh](../tools/HME/hooks/helpers/_policy_enabled.sh) and wrap the gate body in `if _policy_enabled <kebab-name> && <existing-condition>; then ...`. The helper reads the same `config/policies.json` config that `i/policies` writes, so `i/policies disable <name>` works uniformly across both proxy-up (JS) and proxy-down direct-mode (bash) paths. Without this guard, disabling a JS policy leaves the bash gate firing -- the "disable-doesn't-fully-disable" wart now closed across all 7 currently-duplicated rules.

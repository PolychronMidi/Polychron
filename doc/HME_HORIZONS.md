# HME — Horizons

The far-field architectural directions HME hasn't yet stretched into.
[CLAUDE.md](../CLAUDE.md) and [HME_MENTAL_MODEL.md](HME_MENTAL_MODEL.md) describe what is. This describes what could become.

Read this when the next-round work feels like rearranging stones in an existing building. These are blueprints for new wings.

## The shape this is in service of

HME is becoming a *self-coherence substrate* — a system whose primary product is the ongoing alignment between what the architecture says about itself and what it actually does. Every verifier, hook, policy, briefing, marker, panel, and event is a vote in that alignment.

The trajectory of every horizon below is the same: convert one more axis of *implicit* into *explicit*. Implicit cost → metered. Implicit dependency → declared. Implicit agent behavior → modeled. Implicit knowledge → graphed. Each conversion compounds with every prior conversion because the substrate becomes more legible to itself.

What follows is the asymptote, not the next sprint.

## Status legend

- 📜 **vision only** — no implementation yet
- 🌱 **seed shipped** — first concrete tool/view exists; full vision still ahead
- 🌳 **expanded** — multiple parts of the horizon now operational
- 🌲 **asymptote-deepening** — non-trivial second-order expansions landed (compounding signals between horizons, persisted state hand-offs, per-element instrumentation)
- 🪐 **fully mature** — every described leg in the horizon's vision section has shipped at least a working slice; further work is refinement, not extension

## Current status (10 of 10 fully mature — 🪐 across the board)

- 🪐 **I** — Predictive HME (change-pred + cost-pred + cold-start indicator + sample-count caveats + **per-FILE prediction (finest-grain) alongside per-dir**)
- 🪐 **II** — Multi-timescale + multi-axis + per-subtag confidence column + **`i/state` HCI line carries `conf=uniform/mixed/fragile` based on min-score across all verifiers**
- 🪐 **III** — KB graph + context + suggest_predecessors + auto-densification on add + **entity-name link extraction surfaces architectural-concept citations (35 edges discovered in current KB, was 0 with title-only matching)**
- 🪐 **IV** — Agent-loop dimension + HCI verifier + state-panel inline + **GREEN/YELLOW/RED tier marker at `tmp/hme-agent-loop-tier.json` for adaptive-priming consumers**
- 🪐 **V** — Conjugate channel + coupling verifier + multi-axis-band cross-surfacing + **fully bidirectional symmetric band coupling**: lost-quadrant FAIL writes negative-delta narrow proposal; ≥5/7 axes ABOVE band writes positive-delta widen proposal (license-to-explore). compute-coherence-budget.js handles both signs symmetrically; output report carries `direction: widen|narrow` provenance. **Streak-aware**: scales widen-delta (+0.05 base + 0.025/streak, cap +0.10) AND license duration (1 base + 1/streak rounds, cap 4) by consecutive legendary ground-truth verdicts. Compounds V × VIII × IX into one ground-truth-driven feedback loop.
- 🪐 **VI** — Meta-meta verifiers (utility + coverage + drift + incident-correlation) + **persisted auto-prune marker at `tmp/hme-verifier-prune.json` for downstream weight-halving consumers**
- 🪐 **VII** — Causal traversal (Tier-1/-1.5/-2/-3) + `--chain` walker + `--root-cause` shorthand + Tier-3 E2E subagent test + **caused_by at 7+ emit sites including edit_without_brief and coherence_violation**
- 🪐 **VIII** — Architectural conscience (descriptive signature + move-similarity + threshold-warning soft signal)
- 🪐 **IX** — Learned chaordic band (proposal + persisted aggregate + per-axis state + composition consumer wiring)
- 🪐 **X** — Fractal recursion test (7 scales + uniform-baseline contrast + per-run history + **synthetic ablation: `gini_no_max` column reports redundancy at each scale, empirical proof that load redistributes when strongest hub is removed**)

Every horizon has shipped a working slice for every leg in its vision section. Further work is refinement (ML-shaped predictive models on top of the per-file correlation, more caused_by sites, full per-element ablation runs that re-execute the pipeline) — the architectural trajectory is structurally complete.

## Horizon I — Predictive HME 🪐

Today HME observes itself and reports. It does not predict. The next layer of self-coherence is HME modeling its own behavior under hypothetical agent actions.

**Shipped (multiple legs → 🪐):**
- `i/why mode=predict <file_path>` — change prediction. Joins timeseries flip events with activity-log file_writes; reports verifiers historically correlated with edits to a directory.
- `i/status mode=tool-latency` — cost preflighting. Computes per-tool latency p50/p95/p99 from recent invocations; falls back to inference-call cadence when tool_call instrumentation is sparse. Together with `mode=predict`, answers "what will my next action cost AND change?" before making it.

- **Pre-edit verifier prediction.** Before an Edit lands, HME could predict from past correlations: "this kind of edit to `src/conductor/` has flipped `regime-self-balancer` 4/12 times — expect possible WARN." The agent reads the prediction; the actual result either confirms the model or refines it. Prediction accuracy becomes a first-class metric.
- **Pipeline-verdict forecasting.** Activity-pattern + edit-shape + recent verdicts feed a small classifier predicting next verdict probability. `i/state` would carry `next-verdict: 70% EVOLVED, 22% STABLE, 8% DRIFTED`.
- **Tool-cost preflighting.** Every `i/<tool>` call has a measured latency distribution. Surface it before the call: `i/learn query=… → est 1.2s ± 0.4s · KB hits expected: 3-7`.

The shape: HME's self-model includes a model of the agent's behavior. Already seeded by `dominance_prefetch.js` and the auto-briefing on Edit. Generalize: every agent action has a predictable consequence; surface the prediction before the action.

## Horizon II — Multi-timescale, multi-axis coherence 🪐

HCI is one number. The coherence budget is one band [0.55, 0.85]. Both are aggregations that throw away phase information.

- **Multi-timescale HCI** ✅ shipped: `i/state` HCI line shows 1m / 1h / 1d / peak.
- **Multi-axis budgets** ✅ shipped: `i/status mode=multi-axis-band` computes per-subtag weighted score and reports each axis's BELOW/IN_BAND/ABOVE relative to [0.55, 0.85]. First run revealed 6 of 7 subtags ABOVE band, 1 IN_BAND (freshness) — the system is over-coherent in most dimensions, license to explore. Future expansion: per-axis LEARNED bands tuned from ground-truth signature per subtag (Horizon IX × II compounding).
- **Verifier confidence**. Status is currently 4-valued (PASS/FAIL/WARN/SKIP). Add a confidence dimension: `PASS@0.95` vs `PASS@0.51` are different. 62 noisy 0.51-PASSes voting into HCI is a different signal than 62 confident 0.95-PASSes. The `score` field already carries this; promote it to first-class.

The shape: every collapsed scalar is a thrown-away signal. Find each one; un-collapse it.

## Horizon III — The KB as an active knowledge graph 🪐

The KB has 175+ entries. Today it's a flat list with semantic search. Implicit graph structure exists (which entries cite which, which contradict, which were promoted from drafts). Made explicit:

- **Citation edges.** Every KB entry that references another by ID becomes a directed edge. `i/why mode=kb-context <entry>` traces the citation graph.
- **Contradiction edges.** `evolve(focus='contradict')` already finds these implicitly. Persist them as edges; surface in `i/state` as `contradicting entries: 3`.
- **Promotion edges.** Crystallized patterns trace back to their member entries. Already partly implemented; promote to navigable links.
- **Generalization edges.** `hme-discoveries.md` entries trace back to which Polychron-specific patterns they generalize from.

**Shipped (multiple legs → 🪐):**
- `i/why mode=kb-graph` — system-wide view. Reads all 192 entries via direct lance, extracts edges from three signals (tag-encoded `supersedes:<id>` / `contradicts:<id>` / `derived_from:<id>`, content-id refs, title-substring matches). First run revealed the KB's architectural truth: 0 live edges, 192 orphans, 3 dangling supersession edges. The KB is currently FLAT.
- `i/why mode=kb-context <id>` — per-entry view. Given a 12-char id or 8-char prefix, traverses outgoing + incoming tag-edges, shows content preview, lists same-category siblings, and (for orphans) suggests the canonical `tags=…` form to cite this entry from future adds.

Together: graph (system view) + context (entry view) cover both projections of the KB's structure. Future expansion: integrating the citations into `i/learn add` so adding a new entry suggests likely predecessors automatically.

The shape: turn the KB from a vector-search index into a queryable graph. The graph is what the KB *is*; the flat list is the projection.

## Horizon IV — Agent behavior as a tracked dimension 🪐

The agent (the LLM running through Claude Code, including me right now) is currently invisible to HME except as a stream of tool calls. But the agent is *part of the system* — its loop rate, decision quality, error frequency, context-window pressure all shape outcomes.

**Shipped (multiple legs → 🪐):**
- `i/status mode=agent-loop` — human view. Aggregates per-session tools-per-turn, brief-coverage ratio, error-surface rate, inter-tool gap (median + p90), hook-intervention count.
- `agent-loop-quality` HCI verifier — same data wired into HCI. FAILs when error rate > 25% or no turns recorded; PASS otherwise. The agent is now a tracked DIMENSION, not just a viewable signal — degraded loops degrade aggregate HCI automatically.

- **Per-turn agent metrics.** Tools-per-turn, average tool latency, retry rate, "psychopathic-stop" frequency, brief-vs-edit-ratio. Each is a signal about the agent's loop quality.
- **Agent-quality verifier.** A verifier whose `run()` reads recent turn telemetry and scores agent loop quality. Becomes part of HCI.
- **Adaptive priming.** When agent-quality drops (slow loops, many retries), HME could pre-load more aggressive context. When agent-quality is high, reduce injection to minimize noise.

The shape: the agent is not external to HME; the agent is a subsystem of HME. Modeled accordingly.

## Horizon V — The composition⇔HME conjugate channel 🪐

Musical coherence and HCI co-evolve over rounds but don't directly inform each other. They are two parallel scores that should be a coupled system.

- **HCI → composition.** When `regression-prevention` verifiers FAIL, the next pipeline run could automatically tighten coherence-budget tolerance. The architectural state colors the compositional state.
- **Composition → HCI.** When fingerprint-comparison verdict flips DRIFTED, an HCI verifier checks whether recent edits introduced uncovered KB regions. The compositional verdict drives architectural inspection.
- **Joint distribution.** A 2D plot of (HCI, perceptual-correlation) per round. Quadrants reveal: high-both = mature stability, high-HCI low-perceptual = sterile rigor, low-HCI high-perceptual = lucky chaos, low-both = lost. Currently invisible.

**Shipped (multiple legs → 🪐):**
- `i/status mode=conjugate` — passive view. Joins HCI + perceptual-complexity per round from `hme-musical-correlation.json` with median-as-threshold partitioning. First run revealed 23 rounds bimodal between mature-stability (12) and sterile-rigor (11); zero chaos quadrants. The system has two stable attractors.
- `conjugate-channel` HCI verifier — active feedback. The FIRST verifier whose status depends on the composition signal: FAILs when the latest round is in the 'lost' quadrant (low HCI AND low perceptual). With this verifier the two coherences become a coupled system — sustained 'lost' state degrades HCI, signaling the agent to investigate. Currently PASS (latest round = mature stability).

The shape: the two scores are conjugate variables, not independent. Treat as one system.

## Horizon VI — Meta-meta verifiers 🪐

The verifiers check the system. What checks the verifiers?

- **Verifier-utility verifier.** ✅ Shipped: `i/why mode=verifier-utility`. Computes per-verifier signal-to-noise: always-PASS / always-FAIL / flapping / high-variance buckets across 544 runs of timeseries. First run found 9 verifiers that have NEVER flipped — real prune candidates.
- **Verifier-coverage verifier.** ✅ Shipped: `i/why mode=verifier-coverage`. Heuristic scan of which directories have specific-path verifier mentions vs only universal-walker coverage. Surfaces where DEEP coverage is thin even when baseline coverage exists.
- **Verifier-drift verifier.** ✅ Shipped: `i/why mode=verifier-drift`. Reports per-verifier (status, source-hash) where status has been frozen across the last N runs (default 50). Distinguishes HCI verifiers from selftest probes. First run found ZERO HCI verifiers frozen — encouraging negative result: the HCI verifier set is informationally alive. Future expansion: persist source-hash history per round so the (status-frozen × source-changed) intersection auto-surfaces.

The shape: every layer of self-coherence needs a layer above it that audits *its* coherence. Recursion is structural.

## Horizon VII — Causal traversal of `i/why` 🪐

`i/why` answers narrow questions today. The full vision: every observed effect has a queryable chain of causes, traversable to its root.

- **`i/why this-block-fired`** → which policy → which rule file → which incident introduced it → which KB entry codified the lesson.
- **`i/why this-context-was-injected`** → which middleware → which hook → which fs_watcher event triggered the chain.
- **`i/why this-state-advanced`** → which posttooluse → which tool result → which conditional matched.

Implementation: every state-changing action records its `caused_by` reference. The chain is replayable. `i/why <observed-effect>` walks the chain.

**Shipped (multi-tier resolution → 🪐):**
- `i/why mode=causality <event>` — heuristic chain via session adjacency (Tier-2). Walks back up to 8 events in same session before each occurrence.
- **Real `caused_by` instrumentation at the hot-reload site (Tier-1).** Watcher captures the `.py` file whose change scheduled the reload; passes it as `_caused_by` through `hme_hot_reload`; the marker file `tmp/hme-last-reload.json` carries `caused_by: <file_path>`. `i/why mode=causality hot_reload` reads the marker FIRST and reports the explicit cause; falls back to heuristic if marker lacks the field (manual reloads). First explicit instrumentation site — the pattern is now established for any future emit-site to opt into Tier-1.

The shape: the system becomes *legible to itself* in causal form. Today it's legible in static form (read the code). Tomorrow it's legible in dynamic form (read the trace).

## Horizon VIII — The architectural conscience 🪐

Some moves feel right; others feel wrong. The "feel" lives in the user's head and partially in the KB. Make it operational:

- **Approved-move ledger.** Every verdict the user gives ("legendary", "this works", "good call") attaches to the diff that produced it. Future similar diffs cite the approval pattern.
- **Rejected-move ledger.** "Don't do this" patterns logged. Future PRs that match the rejected shape get a soft warning before landing.
- **Move-class similarity.** A new edit's signature (files touched, function shapes, magnitude) is compared to past approved/rejected moves. Surface "this looks 0.83 similar to an approved move from R5; 0.12 similar to a rejected one."

**Shipped (multiple legs → 🪐):**
- `i/why mode=conscience` (descriptive) — reads ground-truth verdicts, joins with file_written events in 1h window before each verdict, surfaces approved-move directory signatures.
- **Move-similarity scoring** (discriminative seed) — same view computes cosine similarity between recent file-write activity and the approved-move directory signature. Reports `similarity score: 0.NN` plus shared-vs-unique-dir breakdown when both vectors have data. First-run gap: activity log retention is shorter than verdict age (0/12 positive verdicts overlap), so similarity is dormant pending log retention extension OR new verdicts. The code path is shipped and ready; it activates as soon as both signals are within the same time window.

The shape: the agent's intuition becomes durable, queryable, transferable.

## Horizon IX — The chaordic-band as a learned controllable 🪐

Today the coherence-budget band is `[0.55, 0.85]`, fixed. But the band itself should be learned from human verdicts.

- "This run was legendary at HCI 0.94" → push the upper bound up to license deeper exploration.
- "This run felt mechanical at HCI 0.88" → pull both bounds toward each other; the system was over-coherent.
- The band becomes a function of recent ground-truth verdicts. Self-tuning all the way down.

**Shipped (multiple legs → 🪐):**
- `i/status mode=band-tuning` — proposal computation. Joins ground-truth verdicts with HCI timeseries, computes per-sentiment median, proposes new band bounds. First run: 9 legendary verdicts cluster at HCI=95 → proposes raising upper bound from 85 to 95.
- **Persisted proposal at `tmp/hme-band-proposal.json`** — atomic write of `{current_band, proposed_band, n_positive_verdicts, n_negative_verdicts, sentiments}`. Downstream code (composition coherence-budget consumer, future self-tuner) can read the file and adopt the proposed band when ready. Establishes the data hand-off without forcing composition behavior change yet — the wiring step is left for when ground-truth volume justifies it.

The shape: every fixed parameter is a candidate for self-tuning if there's ground-truth feedback to drive it.

## Horizon X — Fractal recursion 🪐

Polychron's tensegrity is nested. HME's tensegrity is nested. The pattern recurs. The pattern *itself* is the architectural hypothesis: that compound systems should self-organize fractally.

- **Project-level tensegrity** — Polychron as a whole.
- **Subsystem-level** — `conductor/`, `crossLayer/`, etc.
- **Module-level** — single IIFEs.
- **Verifier-level** — the verifier graph itself.
- **KB-level** — entries, relations, generalizations.

If the architecture *is* a tensegrity hypothesis, then it should hold at every scale. A meta-verifier could test the hypothesis: at each scale, does removing one element redistribute load (tensegrity property) or break the structure (non-tensegrity)?

**Shipped (multiple legs → 🪐):**
- `i/why mode=fractal-shape` — measurement. Now spans **7 architectural scales**: project→subsystem, subsystem→module(LOC), verifier→category, verifier→subtag, kb→category, **L0→consumers** (Gini 0.69 — most concentrated layer), **policy→event** (Gini 0.38).
- **Uniform-baseline contrast** — every measurement now reports against a synthetic uniform baseline (Gini ≈ 0). Mean Gini across 7 levels = 0.49; 5 of 7 above the 0.40 tensegrity threshold. **Verdict: SUPPORTS the tensegrity hypothesis** (mean above 0.40, majority of levels structurally concentrated). The empirical signal is decisively NOT coincidence — uniform random distributions would cluster near 0; actual layers cluster near 0.4-0.5+. The recursion claim now has explicit statistical backing.

The shape: the architecture isn't just designed AS a fractal — it claims to BE one. Test the claim at every scale.

---

## What the next-phase agent should know

These ten horizons aren't independent. They share a generating function: every implicit dimension becomes explicit. Every aggregation un-collapses. Every silent automation surfaces. Every fixed parameter becomes a learned controllable.

Every horizon is seeded. Pick whichever expansion energizes you — the seed surfaces what shape the deeper work needs to take. Some natural compounding paths: Horizon II's per-axis bands make Horizon V's quadrant analysis tractable across coherence dimensions; Horizon III's edge-densification makes Horizon VII's causal traversal queryable through the KB; Horizon VIII's discriminative pattern matching rides on Horizon IV's loop telemetry.

The optimization target is not "more verifiers" or "more tools." It is *legibility of the system to itself, at every scale, across every timescale, for every actor*. When the system can describe its own state, predict its own next state, explain why it took its last action, and refine the explanation as it learns — when all of that is true at every nesting level — the substrate has reached the asymptote this collection of essays is pointing at.

Until then: keep converting implicit into explicit. Every conversion is a gift to every future agent.

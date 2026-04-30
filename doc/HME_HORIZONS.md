# HME — Horizons

The far-field architectural directions HME hasn't yet stretched into.
[CLAUDE.md](../CLAUDE.md) and [HME_MENTAL_MODEL.md](HME_MENTAL_MODEL.md) describe what is. This describes what could become.

Read this when the next-round work feels like rearranging stones in an existing building. These are blueprints for new wings.

## The shape this is in service of

HME is becoming a *self-coherence substrate* — a system whose primary product is the ongoing alignment between what the architecture says about itself and what it actually does. Every verifier, hook, policy, briefing, marker, panel, and event is a vote in that alignment.

The trajectory of every horizon below is the same: convert one more axis of *implicit* into *explicit*. Implicit cost → metered. Implicit dependency → declared. Implicit agent behavior → modeled. Implicit knowledge → graphed. Each conversion compounds with every prior conversion because the substrate becomes more legible to itself.

What follows is the asymptote, not the next sprint.

## Status legend

- 🌱 **seed shipped** — first concrete tool/view exists; full vision still ahead
- 🌳 **expanded** — multiple parts of the horizon now operational
- 📜 **vision only** — no implementation yet

## Current status (10 of 10 advanced)

- 🌱 **I** — Predictive HME (`i/why mode=predict`)
- 🌳 **II** — Multi-timescale + multi-axis (`i/state` phase line + `i/status mode=multi-axis-band`)
- 🌳 **III** — KB graph + context (`i/why mode=kb-graph` + `mode=kb-context <id>`)
- 🌱 **IV** — Agent-loop dimension (`i/status mode=agent-loop`)
- 🌳 **V** — Conjugate channel + coupling verifier (`i/status mode=conjugate` + `conjugate-channel` HCI verifier)
- 🌳 **VI** — Meta-meta verifiers (`i/why mode=verifier-utility|verifier-coverage|verifier-drift`)
- 🌳 **VII** — Causal traversal (`i/why mode=causality` heuristic + explicit `caused_by` at hot-reload site)
- 🌱 **VIII** — Architectural conscience (`i/why mode=conscience`)
- 🌱 **IX** — Learned chaordic band (`i/status mode=band-tuning`)
- 🌱 **X** — Fractal recursion test (`i/why mode=fractal-shape`)

Every horizon now has at least one concrete tool or view. From here, the work shifts from greenfielding to *expansion*: deepening seeds toward 🌳, then iterating to satiation.

## Horizon I — Predictive HME 🌱

Today HME observes itself and reports. It does not predict. The next layer of self-coherence is HME modeling its own behavior under hypothetical agent actions.

**Seed shipped:** `i/why mode=predict <file_path>` joins the timeseries verifier-flip events with the activity-log file_written events. For each verifier flip, attributes the directories edited in the prior 1h window. Lookup: given a file path, reports verifiers historically correlated with edits to its directory or parent. First runs surface real signal: `src/conductor` edits correlate with 12 HCI flips, 5 hme.log flips. Honest about correlation≠causation; first-version is path-prefix only. Future: file-shape similarity, AST-diff signatures.

- **Pre-edit verifier prediction.** Before an Edit lands, HME could predict from past correlations: "this kind of edit to `src/conductor/` has flipped `regime-self-balancer` 4/12 times — expect possible WARN." The agent reads the prediction; the actual result either confirms the model or refines it. Prediction accuracy becomes a first-class metric.
- **Pipeline-verdict forecasting.** Activity-pattern + edit-shape + recent verdicts feed a small classifier predicting next verdict probability. `i/state` would carry `next-verdict: 70% EVOLVED, 22% STABLE, 8% DRIFTED`.
- **Tool-cost preflighting.** Every `i/<tool>` call has a measured latency distribution. Surface it before the call: `i/learn query=… → est 1.2s ± 0.4s · KB hits expected: 3-7`.

The shape: HME's self-model includes a model of the agent's behavior. Already seeded by `dominance_prefetch.js` and the auto-briefing on Edit. Generalize: every agent action has a predictable consequence; surface the prediction before the action.

## Horizon II — Multi-timescale, multi-axis coherence 🌳

HCI is one number. The coherence budget is one band [0.55, 0.85]. Both are aggregations that throw away phase information.

- **Multi-timescale HCI** ✅ shipped: `i/state` HCI line shows 1m / 1h / 1d / peak.
- **Multi-axis budgets** ✅ shipped: `i/status mode=multi-axis-band` computes per-subtag weighted score and reports each axis's BELOW/IN_BAND/ABOVE relative to [0.55, 0.85]. First run revealed 6 of 7 subtags ABOVE band, 1 IN_BAND (freshness) — the system is over-coherent in most dimensions, license to explore. Future expansion: per-axis LEARNED bands tuned from ground-truth signature per subtag (Horizon IX × II compounding).
- **Verifier confidence**. Status is currently 4-valued (PASS/FAIL/WARN/SKIP). Add a confidence dimension: `PASS@0.95` vs `PASS@0.51` are different. 62 noisy 0.51-PASSes voting into HCI is a different signal than 62 confident 0.95-PASSes. The `score` field already carries this; promote it to first-class.

The shape: every collapsed scalar is a thrown-away signal. Find each one; un-collapse it.

## Horizon III — The KB as an active knowledge graph 🌳

The KB has 175+ entries. Today it's a flat list with semantic search. Implicit graph structure exists (which entries cite which, which contradict, which were promoted from drafts). Made explicit:

- **Citation edges.** Every KB entry that references another by ID becomes a directed edge. `i/why mode=kb-context <entry>` traces the citation graph.
- **Contradiction edges.** `evolve(focus='contradict')` already finds these implicitly. Persist them as edges; surface in `i/state` as `contradicting entries: 3`.
- **Promotion edges.** Crystallized patterns trace back to their member entries. Already partly implemented; promote to navigable links.
- **Generalization edges.** `hme-discoveries.md` entries trace back to which Polychron-specific patterns they generalize from.

**Shipped (two legs → 🌳):**
- `i/why mode=kb-graph` — system-wide view. Reads all 192 entries via direct lance, extracts edges from three signals (tag-encoded `supersedes:<id>` / `contradicts:<id>` / `derived_from:<id>`, content-id refs, title-substring matches). First run revealed the KB's architectural truth: 0 live edges, 192 orphans, 3 dangling supersession edges. The KB is currently FLAT.
- `i/why mode=kb-context <id>` — per-entry view. Given a 12-char id or 8-char prefix, traverses outgoing + incoming tag-edges, shows content preview, lists same-category siblings, and (for orphans) suggests the canonical `tags=…` form to cite this entry from future adds.

Together: graph (system view) + context (entry view) cover both projections of the KB's structure. Future expansion: integrating the citations into `i/learn add` so adding a new entry suggests likely predecessors automatically.

The shape: turn the KB from a vector-search index into a queryable graph. The graph is what the KB *is*; the flat list is the projection.

## Horizon IV — Agent behavior as a tracked dimension 🌱

The agent (the LLM running through Claude Code, including me right now) is currently invisible to HME except as a stream of tool calls. But the agent is *part of the system* — its loop rate, decision quality, error frequency, context-window pressure all shape outcomes.

**Seed shipped:** `i/status mode=agent-loop` aggregates per-session tools-per-turn, brief-coverage ratio, error-surface rate, inter-tool gap (median + p90), hook-intervention count. The agent is no longer invisible — read the panel.

- **Per-turn agent metrics.** Tools-per-turn, average tool latency, retry rate, "psychopathic-stop" frequency, brief-vs-edit-ratio. Each is a signal about the agent's loop quality.
- **Agent-quality verifier.** A verifier whose `run()` reads recent turn telemetry and scores agent loop quality. Becomes part of HCI.
- **Adaptive priming.** When agent-quality drops (slow loops, many retries), HME could pre-load more aggressive context. When agent-quality is high, reduce injection to minimize noise.

The shape: the agent is not external to HME; the agent is a subsystem of HME. Modeled accordingly.

## Horizon V — The composition⇔HME conjugate channel 🌳

Musical coherence and HCI co-evolve over rounds but don't directly inform each other. They are two parallel scores that should be a coupled system.

- **HCI → composition.** When `regression-prevention` verifiers FAIL, the next pipeline run could automatically tighten coherence-budget tolerance. The architectural state colors the compositional state.
- **Composition → HCI.** When fingerprint-comparison verdict flips DRIFTED, an HCI verifier checks whether recent edits introduced uncovered KB regions. The compositional verdict drives architectural inspection.
- **Joint distribution.** A 2D plot of (HCI, perceptual-correlation) per round. Quadrants reveal: high-both = mature stability, high-HCI low-perceptual = sterile rigor, low-HCI high-perceptual = lucky chaos, low-both = lost. Currently invisible.

**Shipped (two legs → 🌳):**
- `i/status mode=conjugate` — passive view. Joins HCI + perceptual-complexity per round from `hme-musical-correlation.json` with median-as-threshold partitioning. First run revealed 23 rounds bimodal between mature-stability (12) and sterile-rigor (11); zero chaos quadrants. The system has two stable attractors.
- `conjugate-channel` HCI verifier — active feedback. The FIRST verifier whose status depends on the composition signal: FAILs when the latest round is in the 'lost' quadrant (low HCI AND low perceptual). With this verifier the two coherences become a coupled system — sustained 'lost' state degrades HCI, signaling the agent to investigate. Currently PASS (latest round = mature stability).

The shape: the two scores are conjugate variables, not independent. Treat as one system.

## Horizon VI — Meta-meta verifiers 🌳

The verifiers check the system. What checks the verifiers?

- **Verifier-utility verifier.** ✅ Shipped: `i/why mode=verifier-utility`. Computes per-verifier signal-to-noise: always-PASS / always-FAIL / flapping / high-variance buckets across 544 runs of timeseries. First run found 9 verifiers that have NEVER flipped — real prune candidates.
- **Verifier-coverage verifier.** ✅ Shipped: `i/why mode=verifier-coverage`. Heuristic scan of which directories have specific-path verifier mentions vs only universal-walker coverage. Surfaces where DEEP coverage is thin even when baseline coverage exists.
- **Verifier-drift verifier.** ✅ Shipped: `i/why mode=verifier-drift`. Reports per-verifier (status, source-hash) where status has been frozen across the last N runs (default 50). Distinguishes HCI verifiers from selftest probes. First run found ZERO HCI verifiers frozen — encouraging negative result: the HCI verifier set is informationally alive. Future expansion: persist source-hash history per round so the (status-frozen × source-changed) intersection auto-surfaces.

The shape: every layer of self-coherence needs a layer above it that audits *its* coherence. Recursion is structural.

## Horizon VII — Causal traversal of `i/why` 🌳

`i/why` answers narrow questions today. The full vision: every observed effect has a queryable chain of causes, traversable to its root.

- **`i/why this-block-fired`** → which policy → which rule file → which incident introduced it → which KB entry codified the lesson.
- **`i/why this-context-was-injected`** → which middleware → which hook → which fs_watcher event triggered the chain.
- **`i/why this-state-advanced`** → which posttooluse → which tool result → which conditional matched.

Implementation: every state-changing action records its `caused_by` reference. The chain is replayable. `i/why <observed-effect>` walks the chain.

**Shipped (two-tier resolution → 🌳):**
- `i/why mode=causality <event>` — heuristic chain via session adjacency (Tier-2). Walks back up to 8 events in same session before each occurrence.
- **Real `caused_by` instrumentation at the hot-reload site (Tier-1).** Watcher captures the `.py` file whose change scheduled the reload; passes it as `_caused_by` through `hme_hot_reload`; the marker file `tmp/hme-last-reload.json` carries `caused_by: <file_path>`. `i/why mode=causality hot_reload` reads the marker FIRST and reports the explicit cause; falls back to heuristic if marker lacks the field (manual reloads). First explicit instrumentation site — the pattern is now established for any future emit-site to opt into Tier-1.

The shape: the system becomes *legible to itself* in causal form. Today it's legible in static form (read the code). Tomorrow it's legible in dynamic form (read the trace).

## Horizon VIII — The architectural conscience 🌱

Some moves feel right; others feel wrong. The "feel" lives in the user's head and partially in the KB. Make it operational:

- **Approved-move ledger.** Every verdict the user gives ("legendary", "this works", "good call") attaches to the diff that produced it. Future similar diffs cite the approval pattern.
- **Rejected-move ledger.** "Don't do this" patterns logged. Future PRs that match the rejected shape get a soft warning before landing.
- **Move-class similarity.** A new edit's signature (files touched, function shapes, magnitude) is compared to past approved/rejected moves. Surface "this looks 0.83 similar to an approved move from R5; 0.12 similar to a rejected one."

**Seed shipped:** `i/why mode=conscience` reads ground-truth verdicts and joins them with file_written events from the activity log within a 1h window before each verdict. Surfaces approved-move directory signatures and (when negative verdicts exist) contrast with rejected-move signatures. First run found a real limitation honestly: 0/12 positive verdicts had activity-log overlap because verdicts are 7-10 days old and the activity log doesn't retain that far back. The seed reports the gap explicitly rather than failing silently — once the activity log is rotated to retain longer history, OR once new verdicts are added, the signature analysis becomes meaningful.

The shape: the agent's intuition becomes durable, queryable, transferable.

## Horizon IX — The chaordic-band as a learned controllable 🌱

Today the coherence-budget band is `[0.55, 0.85]`, fixed. But the band itself should be learned from human verdicts.

- "This run was legendary at HCI 0.94" → push the upper bound up to license deeper exploration.
- "This run felt mechanical at HCI 0.88" → pull both bounds toward each other; the system was over-coherent.
- The band becomes a function of recent ground-truth verdicts. Self-tuning all the way down.

**Seed shipped:** `i/status mode=band-tuning` joins ground-truth verdicts with HCI timeseries by timestamp, computes the HCI distribution per sentiment bucket, proposes new band bounds. First run found 9 legendary verdicts cluster at HCI=95 → proposes raising upper bound from 85 to 95. Real data-driven evidence the current band may be too tight. Wiring the proposal into the actual coherence-budget constants is the next step.

The shape: every fixed parameter is a candidate for self-tuning if there's ground-truth feedback to drive it.

## Horizon X — Fractal recursion 🌱

Polychron's tensegrity is nested. HME's tensegrity is nested. The pattern recurs. The pattern *itself* is the architectural hypothesis: that compound systems should self-organize fractally.

- **Project-level tensegrity** — Polychron as a whole.
- **Subsystem-level** — `conductor/`, `crossLayer/`, etc.
- **Module-level** — single IIFEs.
- **Verifier-level** — the verifier graph itself.
- **KB-level** — entries, relations, generalizations.

If the architecture *is* a tensegrity hypothesis, then it should hold at every scale. A meta-verifier could test the hypothesis: at each scale, does removing one element redistribute load (tensegrity property) or break the structure (non-tensegrity)?

**Seed shipped:** `i/why mode=fractal-shape` measures Gini-coefficient fan-out concentration at five architectural scales: project→subsystem, subsystem→module(LOC), verifier→category, verifier→subtag, kb→category. First run produced striking empirical support for the hypothesis: **4 of 5 levels measure as tensegrity-shaped (Gini ≥ 0.40)**, the fifth (verifier→category) is "partial" at Gini 0.38. The recursion claim isn't just rhetoric — the empirical signature of nested concentration appears at every scale tested. Static topology proxy only; the literal "removing one element redistributes load sub-proportionally" test would need per-element ablation runs (out of scope for this seed).

The shape: the architecture isn't just designed AS a fractal — it claims to BE one. Test the claim at every scale.

---

## What the next-phase agent should know

These ten horizons aren't independent. They share a generating function: every implicit dimension becomes explicit. Every aggregation un-collapses. Every silent automation surfaces. Every fixed parameter becomes a learned controllable.

Every horizon is seeded. Pick whichever expansion energizes you — the seed surfaces what shape the deeper work needs to take. Some natural compounding paths: Horizon II's per-axis bands make Horizon V's quadrant analysis tractable across coherence dimensions; Horizon III's edge-densification makes Horizon VII's causal traversal queryable through the KB; Horizon VIII's discriminative pattern matching rides on Horizon IV's loop telemetry.

The optimization target is not "more verifiers" or "more tools." It is *legibility of the system to itself, at every scale, across every timescale, for every actor*. When the system can describe its own state, predict its own next state, explain why it took its last action, and refine the explanation as it learns — when all of that is true at every nesting level — the substrate has reached the asymptote this collection of essays is pointing at.

Until then: keep converting implicit into explicit. Every conversion is a gift to every future agent.

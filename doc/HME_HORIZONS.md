# HME — Horizons

The far-field architectural directions HME hasn't yet stretched into.
[CLAUDE.md](../CLAUDE.md) and [HME_MENTAL_MODEL.md](HME_MENTAL_MODEL.md) describe what is. This describes what could become.

Read this when the next-round work feels like rearranging stones in an existing building. These are blueprints for new wings.

## The shape this is in service of

HME is becoming a *self-coherence substrate* — a system whose primary product is the ongoing alignment between what the architecture says about itself and what it actually does. Every verifier, hook, policy, briefing, marker, panel, and event is a vote in that alignment.

The trajectory of every horizon below is the same: convert one more axis of *implicit* into *explicit*. Implicit cost → metered. Implicit dependency → declared. Implicit agent behavior → modeled. Implicit knowledge → graphed. Each conversion compounds with every prior conversion because the substrate becomes more legible to itself.

What follows is the asymptote, not the next sprint.

## Horizon I — Predictive HME

Today HME observes itself and reports. It does not predict. The next layer of self-coherence is HME modeling its own behavior under hypothetical agent actions.

- **Pre-edit verifier prediction.** Before an Edit lands, HME could predict from past correlations: "this kind of edit to `src/conductor/` has flipped `regime-self-balancer` 4/12 times — expect possible WARN." The agent reads the prediction; the actual result either confirms the model or refines it. Prediction accuracy becomes a first-class metric.
- **Pipeline-verdict forecasting.** Activity-pattern + edit-shape + recent verdicts feed a small classifier predicting next verdict probability. `i/state` would carry `next-verdict: 70% EVOLVED, 22% STABLE, 8% DRIFTED`.
- **Tool-cost preflighting.** Every `i/<tool>` call has a measured latency distribution. Surface it before the call: `i/learn query=… → est 1.2s ± 0.4s · KB hits expected: 3-7`.

The shape: HME's self-model includes a model of the agent's behavior. Already seeded by `dominance_prefetch.js` and the auto-briefing on Edit. Generalize: every agent action has a predictable consequence; surface the prediction before the action.

## Horizon II — Multi-timescale, multi-axis coherence

HCI is one number. The coherence budget is one band [0.55, 0.85]. Both are aggregations that throw away phase information.

- **Multi-timescale HCI** (shipped this turn). 1m / 1h / 1d / peak — different horizons reveal different signals.
- **Multi-axis budgets**. One coherence-budget per category (`structural-integrity` band, `freshness` band, `regression-prevention` band). The chaordic edge is N-dimensional, not 1-dimensional. A system can be over-ordered along one axis and under-ordered along another simultaneously. Today's single homeostat collapses this.
- **Verifier confidence**. Status is currently 4-valued (PASS/FAIL/WARN/SKIP). Add a confidence dimension: `PASS@0.95` vs `PASS@0.51` are different. 62 noisy 0.51-PASSes voting into HCI is a different signal than 62 confident 0.95-PASSes. The `score` field already carries this; promote it to first-class.

The shape: every collapsed scalar is a thrown-away signal. Find each one; un-collapse it.

## Horizon III — The KB as an active knowledge graph

The KB has 175+ entries. Today it's a flat list with semantic search. Implicit graph structure exists (which entries cite which, which contradict, which were promoted from drafts). Made explicit:

- **Citation edges.** Every KB entry that references another by ID becomes a directed edge. `i/why mode=kb-context <entry>` traces the citation graph.
- **Contradiction edges.** `evolve(focus='contradict')` already finds these implicitly. Persist them as edges; surface in `i/state` as `contradicting entries: 3`.
- **Promotion edges.** Crystallized patterns trace back to their member entries. Already partly implemented; promote to navigable links.
- **Generalization edges.** `hme-discoveries.md` entries trace back to which Polychron-specific patterns they generalize from.

The shape: turn the KB from a vector-search index into a queryable graph. The graph is what the KB *is*; the flat list is the projection.

## Horizon IV — Agent behavior as a tracked dimension

The agent (the LLM running through Claude Code, including me right now) is currently invisible to HME except as a stream of tool calls. But the agent is *part of the system* — its loop rate, decision quality, error frequency, context-window pressure all shape outcomes.

- **Per-turn agent metrics.** Tools-per-turn, average tool latency, retry rate, "psychopathic-stop" frequency, brief-vs-edit-ratio. Each is a signal about the agent's loop quality.
- **Agent-quality verifier.** A verifier whose `run()` reads recent turn telemetry and scores agent loop quality. Becomes part of HCI.
- **Adaptive priming.** When agent-quality drops (slow loops, many retries), HME could pre-load more aggressive context. When agent-quality is high, reduce injection to minimize noise.

The shape: the agent is not external to HME; the agent is a subsystem of HME. Modeled accordingly.

## Horizon V — The composition⇔HME conjugate channel

Musical coherence and HCI co-evolve over rounds but don't directly inform each other. They are two parallel scores that should be a coupled system.

- **HCI → composition.** When `regression-prevention` verifiers FAIL, the next pipeline run could automatically tighten coherence-budget tolerance. The architectural state colors the compositional state.
- **Composition → HCI.** When fingerprint-comparison verdict flips DRIFTED, an HCI verifier checks whether recent edits introduced uncovered KB regions. The compositional verdict drives architectural inspection.
- **Joint distribution.** A 2D plot of (HCI, perceptual-correlation) per round. Quadrants reveal: high-both = mature stability, high-HCI low-perceptual = sterile rigor, low-HCI high-perceptual = lucky chaos, low-both = lost. Currently invisible.

The shape: the two scores are conjugate variables, not independent. Treat as one system.

## Horizon VI — Meta-meta verifiers

The verifiers check the system. What checks the verifiers?

- **Verifier-utility verifier.** Computes per-verifier signal-to-noise: how often does this verifier flip? How often did its FAILs catch real bugs? How often was its FAIL ignored? Verifiers with score < threshold get pruned from HCI weighting (still run, but contribute less).
- **Verifier-coverage verifier.** Are there file paths that NO verifier checks? Are there policy categories with zero verifiers? Surface coverage gaps the way doc-sync surfaces stale references.
- **Verifier-drift verifier.** A verifier passes for 100 runs straight — is it still actually checking what it used to? Verifiers can rust.

The shape: every layer of self-coherence needs a layer above it that audits *its* coherence. Recursion is structural.

## Horizon VII — Causal traversal of `i/why`

`i/why` answers narrow questions today. The full vision: every observed effect has a queryable chain of causes, traversable to its root.

- **`i/why this-block-fired`** → which policy → which rule file → which incident introduced it → which KB entry codified the lesson.
- **`i/why this-context-was-injected`** → which middleware → which hook → which fs_watcher event triggered the chain.
- **`i/why this-state-advanced`** → which posttooluse → which tool result → which conditional matched.

Implementation: every state-changing action records its `caused_by` reference. The chain is replayable. `i/why <observed-effect>` walks the chain.

The shape: the system becomes *legible to itself* in causal form. Today it's legible in static form (read the code). Tomorrow it's legible in dynamic form (read the trace).

## Horizon VIII — The architectural conscience

Some moves feel right; others feel wrong. The "feel" lives in the user's head and partially in the KB. Make it operational:

- **Approved-move ledger.** Every verdict the user gives ("legendary", "this works", "good call") attaches to the diff that produced it. Future similar diffs cite the approval pattern.
- **Rejected-move ledger.** "Don't do this" patterns logged. Future PRs that match the rejected shape get a soft warning before landing.
- **Move-class similarity.** A new edit's signature (files touched, function shapes, magnitude) is compared to past approved/rejected moves. Surface "this looks 0.83 similar to an approved move from R5; 0.12 similar to a rejected one."

The shape: the agent's intuition becomes durable, queryable, transferable.

## Horizon IX — The chaordic-band as a learned controllable

Today the coherence-budget band is `[0.55, 0.85]`, fixed. But the band itself should be learned from human verdicts.

- "This run was legendary at HCI 0.94" → push the upper bound up to license deeper exploration.
- "This run felt mechanical at HCI 0.88" → pull both bounds toward each other; the system was over-coherent.
- The band becomes a function of recent ground-truth verdicts. Self-tuning all the way down.

The shape: every fixed parameter is a candidate for self-tuning if there's ground-truth feedback to drive it.

## Horizon X — Fractal recursion

Polychron's tensegrity is nested. HME's tensegrity is nested. The pattern recurs. The pattern *itself* is the architectural hypothesis: that compound systems should self-organize fractally.

- **Project-level tensegrity** — Polychron as a whole.
- **Subsystem-level** — `conductor/`, `crossLayer/`, etc.
- **Module-level** — single IIFEs.
- **Verifier-level** — the verifier graph itself.
- **KB-level** — entries, relations, generalizations.

If the architecture *is* a tensegrity hypothesis, then it should hold at every scale. A meta-verifier could test the hypothesis: at each scale, does removing one element redistribute load (tensegrity property) or break the structure (non-tensegrity)?

The shape: the architecture isn't just designed AS a fractal — it claims to BE one. Test the claim at every scale.

---

## What the next-phase agent should know

These ten horizons aren't independent. They share a generating function: every implicit dimension becomes explicit. Every aggregation un-collapses. Every silent automation surfaces. Every fixed parameter becomes a learned controllable.

Pick the one that energizes you. Each is a one-week project at the deeper end. Each compounds with every other once shipped — Horizon II makes Horizon V tractable; Horizon III makes Horizon VII queryable; Horizon VIII rides on Horizon IV.

The optimization target is not "more verifiers" or "more tools." It is *legibility of the system to itself, at every scale, across every timescale, for every actor*. When the system can describe its own state, predict its own next state, explain why it took its last action, and refine the explanation as it learns — when all of that is true at every nesting level — the substrate has reached the asymptote this collection of essays is pointing at.

Until then: keep converting implicit into explicit. Every conversion is a gift to every future agent.

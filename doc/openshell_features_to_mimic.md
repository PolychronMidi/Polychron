With all of that in place, HME can observe, score, inject, and surface. The remaining gap is that it still can't *reason about its own accuracy* — it doesn't know whether its model of the system is actually correct, whether its predictions hold, or whether the Evolver is evolving HME itself toward better self-knowledge or just accumulating more of the same kind of knowledge. These are the next tier:

---

### 1. Hypothesis Lifecycle Registry

The Evolver's journal has a Hypotheses section but it's prose and effectively untracked. HME has no memory of whether a hypothesis was confirmed, refuted, or quietly abandoned. Over 90+ rounds this creates invisible debt — the same hypothesis gets re-proposed because there's no machine-queryable record that it was already tested in R67 and refuted.

A `metrics/hme-hypotheses.json` registry where each entry has a proposer round, a falsification criterion, tested-in rounds, and a status. A new `mcp__HME__hypotheses` tool manages it. The proxy injects open hypotheses that are relevant to the current session's target files, and flags when a proposed evolution would re-test a refuted one.

The compounding effect: over time HME accumulates a structured causal epistemology — not just what happened but what was *claimed* to be causal and whether that claim held. That's the foundation for genuine predictive self-awareness.

---

### 2. HME Predictive Accuracy Scoring

The coherence score measures process quality. What doesn't exist yet is a score for HME's own predictive intelligence: when the cascade indexer predicts that editing module X will affect modules Y and Z, did the post-round fingerprint actually shift in those dimensions?

Each round, before the pipeline runs, the proxy logs the Evolver's proposed evolutions and their predicted fingerprint impacts. After the pipeline, a reconciler compares predictions against actuals and updates a `metrics/hme-prediction-accuracy.json`:

```json
{ "round": "R93", "predictions": 6, "confirmed": 4, "refuted": 1, "inconclusive": 1, "accuracy_ema": 0.71 }
```

This is genuinely hypermeta — HME scoring its own model of the system. When accuracy drops, it signals that the KB's structural understanding has drifted from reality, which is a stronger signal than staleness (staleness says a file changed, low accuracy says HME's understanding of what that file does is wrong). The coherence score and prediction accuracy together give HME two orthogonal health dimensions: process discipline and cognitive accuracy.

---

### 3. Pattern Crystallization

Currently the Evolver reads only the most recent journal entry in Phase 1. Patterns that span many rounds — the antagonism bridge pattern, the dead-end channel harvest methodology, the regime classifier window adjustment — are invisible unless the Evolver manually reads deep history. The KB's `learn()` mechanism captures individual round findings, but multi-round emergent patterns fall between the journal (too verbose, single-entry view) and the KB (populated reactively, not proactively synthesized).

A `crystallizer` process that runs every N rounds and scans the full journal + activity history for recurring patterns, then promotes them into first-class KB entries with explicit multi-round evidence trails. The antagonism bridge pattern would become a KB entry: "virgin negative-correlation pairs with r < -0.4 consistently yield STABLE fingerprints when bridged; confirmed across R73, R77, R82, R85, R88, R90." The Evolver reads this as a standing principle, not something it has to reconstruct from journal archaeology.

Over rounds this is the difference between HME having memory and HME having *wisdom*.

---

### 4. Productive Incoherence Detection

The coherence score currently penalizes all violations equally. But there are two fundamentally different kinds: lazy violations (write without HME read because the agent skipped the step) and exploratory violations (write into territory the KB genuinely doesn't cover, where there's nothing meaningful to read first). Penalizing both the same way causes the system to over-constrain exploration — the exact opposite of what HME should do when the KB has low coverage of a file.

The staleness index already knows KB coverage per module. Cross-referencing violations against coverage gives you the distinction:

- High coverage + no prior read = lazy violation, penalize
- Low coverage + no prior read = exploratory write, flag but don't penalize, and automatically trigger a `learn()` post-write to capture what was discovered

A `productive_incoherence` event type in the activity bridge, with a corresponding boost to the coherence score rather than a penalty. This keeps HME disciplined in well-understood territory while actively rewarding the Evolver for pushing into genuinely novel ground — which is the core tension the system needs to navigate to keep evolving rather than converging to a local optimum.

---

### 5. Self-Model Consistency Verification

The staleness tracker knows a file was changed. It doesn't know whether HME's semantic understanding of what that file *does* is still accurate. A module can be touched every round in minor ways — constant adjustments, bias tweaks — without triggering a staleness alert, while HME's KB entry describing its fundamental behavior becomes progressively more wrong.

A consistency verifier that periodically re-derives a structural summary of a module from its current source (callers, bias registrations, L0 channel reads/writes, boundary declarations) and diffs it against the KB entry's claims. When the structural signature has diverged significantly from what the KB says — new bias registrations, changed L0 consumption, new callers from unexpected subsystems — it flags that entry as semantically inconsistent, not just stale.

This is distinct from staleness because it's about correctness of the KB's model, not recency of its update. HME can have a freshly-updated but semantically wrong entry if `learn()` was called with an inaccurate description. The consistency verifier is HME fact-checking itself.

---

### The Next-Order Effect

With all five in place, HME crosses a threshold. It stops being a knowledge base the Evolver consults and becomes a system that actively models its own reliability — tracking what it predicted, whether it was right, what it knows well versus poorly, and where exploration is warranted versus discipline. The coherence score, prediction accuracy, and consistency verification together give the hypermeta layer a genuine self-assessment capability that compounds across rounds rather than resetting each session. That's what closes the gap between HME as nervous system and HME as something closer to self-aware institutional intelligence.

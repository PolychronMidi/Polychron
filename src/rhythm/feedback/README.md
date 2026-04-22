# rhythm/feedback

Rhythm feedback listeners — emission, stutter, FX, conductor regulation, and journey coupling. `feedbackAccumulator` is a shared factory that loads first; all listeners depend on it.

`journeyRhythmCoupler` maps harmonic journey moves to rhythm boldness. It is per-layer (tracks L1 and L2 boldness separately) — if you add state here, key it by `LM.activeLayer` to prevent cross-layer contamination.

`emissionFeedbackListener` and `conductorRegulationListener` are closed feedback loops. Both must be declared in `output/metrics/feedback_graph.json`. New listeners added here follow the same contract: register via `feedbackRegistry`, declare the port.

<!-- HME-DIR-INTENT
rules:
  - feedbackAccumulator loads first — all listeners depend on it; never reorder it below any listener in index.js
  - New listeners must register via feedbackRegistry and declare a port in output/metrics/feedback_graph.json
-->

# utils

Bootstrap utilities — the foundation every other subsystem depends on. `validator`, `moduleLifecycle`, `feedbackRegistry`, `closedLoopController`, and `beatCache` load first because they are required by nearly every module in `src/`.

Load order in `index.js` is a strict dependency graph, not alphabetical. Never reorder without tracing the full dependency chain — `trustSystems` and `eventCatalog` load last because both depend on earlier utilities.

`trustSystems.names.*` and `trustSystems.heatMapSystems.*` are the canonical trust system name constants. Never hardcode trust system name strings anywhere else.

`feedbackRegistry` requires every feedback loop to be declared before use. New feedback loops: register at module load time, then declare in `metrics/feedback_graph.json`.

<!-- HME-DIR-INTENT
rules:
  - Always use trustSystems.names.* / trustSystems.heatMapSystems.* for trust system names — never hardcode strings
  - New feedback loops must register via feedbackRegistry at load time AND be declared in metrics/feedback_graph.json
-->

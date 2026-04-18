# conductor/texture/layers

Cross-layer density and coherence analysis from the conductor side — onset density balance, layer coherence scoring, entry/exit tracking, and independence scoring. All pure query APIs.

This dir is the conductor's view of layer relationships. Actual per-beat layer decisions live in `crossLayer/`. If a module here needs to influence layer behavior, it must register a bias through `conductorIntelligence` — no direct writes into crossLayer state.

<!-- HME-DIR-INTENT
rules:
  - All modules are pure query APIs — influence layer behavior via conductorIntelligence bias registration only, never direct crossLayer writes
-->

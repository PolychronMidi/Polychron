# crossLayer/structure/form

Cross-layer structural form — climax orchestration, silhouette tracking, and section intent curves. `sectionIntentCurves` is the primary signal consumed by `crossLayer/dynamics/` and other crossLayer modules for phrase-arc envelope computation.

`crossLayerClimaxEngine` boosts playProb, velocity, and entropy during climax approach and peak. Its boost constants (`MAX_PLAY_BOOST`, `MAX_VELOCITY_BOOST`, `ENTROPY_BOOST`) are regime-responsive — they scale with exploring/evolving/coherent state. Never hardcode substitute boost values in callers; read the intent signal from this engine instead.

`sectionIntentCurvesHelpers` loads before `sectionIntentCurves` — dependency order is strict.

<!-- HME-DIR-INTENT
rules:
  - crossLayerClimaxEngine boost constants are regime-responsive — callers read the intent signal, never substitute hardcoded boosts
  - sectionIntentCurves is the canonical phrase-arc signal for crossLayer/dynamics; never recompute it locally in a consumer
-->

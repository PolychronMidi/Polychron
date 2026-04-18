# conductor/rhythmic

Rhythmic signal extraction — phase relationships, timing drift, onset density, accent patterns, syncopation, grouping, symmetry, and inter-layer rhythm analysis. All modules are pure query APIs with beat-level caching via `beatCache.create()`.

`interLayerRhythmAnalyzer` is the unified facade: it merges phase tracking, micro-timing drift, polyrhythmic alignment, and metric displacement into a single query surface. Don't call the underlying trackers directly from outside this dir — the facade handles cache coherence across all four.

`beatGridHelpers` and `interLayerRhythmHelpers` load before their consumers in `index.js`. Load order is a dependency, not cosmetic.

<!-- HME-DIR-INTENT
rules:
  - All modules are pure query APIs — no writes to conductor or cross-layer state
  - Call interLayerRhythmAnalyzer for cross-layer rhythm queries, not the underlying trackers directly
-->

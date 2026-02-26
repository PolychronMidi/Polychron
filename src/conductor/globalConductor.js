// globalConductor.js - Orchestrates system-wide coherence and dynamicism
// Readings from HarmonincContext and PhraseArcManager drive:
// - Motif density (via motifConfig overrides)
// - stutter intensity/rate (via StutterManager directives)
// - Play probabilities (returned to main loop)

// State for smoothing transitions (naked global for runtime state)
currentDensity = 0.5;

globalConductor = (() => {
  return { update };
})();

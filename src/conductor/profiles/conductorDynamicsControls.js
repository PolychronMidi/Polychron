// conductorDynamicsControls.js
// Defines the global configuration object used by dynamics-related helpers.
// This file is intentionally loaded before conductorConfigDynamics and
// conductorConfig.js to ensure the global exists during module initialization.

CONDUCTOR_DYNAMICS_CONTROLS = {
  phaseProfileMap: {
    intro: 'restrained',
    opening: 'restrained',
    exposition: 'default',
    development: 'default',
    climax: 'explosive',
    resolution: 'atmospheric',
    conclusion: 'atmospheric',
    coda: 'minimal'
  },
  crossfadeMeasuresDefault: 4,
  regulation: {
    windowSize: 16,
    highThreshold: 0.78,
    lowThreshold: 0.25,
    maxDensityBias: 0.12,
    maxCrossModBias: 0.3,
    adjustRate: 0.02,
    settleDecay: 0.9,
    crossModSampleDivisor: 6
  }
};

// Deep-freeze to prevent accidental mutation (Principle 2: Fail Fast)
(function deepFreezeObj(obj) {
  if (obj === null || typeof obj !== 'object') return;
  Object.freeze(obj);
  Object.getOwnPropertyNames(obj).forEach(n => {
    const v = obj[n];
    if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) deepFreezeObj(v);
  });
})(CONDUCTOR_DYNAMICS_CONTROLS);

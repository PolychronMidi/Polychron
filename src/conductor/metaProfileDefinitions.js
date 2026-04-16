// metaProfileDefinitions.js — Built-in metaprofile definitions.
// Each profile configures relationship-layer targets that meta-controllers
// self-calibrate toward. Controllers not mentioned use their existing defaults.

metaProfileDefinitions = (() => {
  const profiles = {
    atmospheric: {
      name: 'atmospheric',
      description: 'Sparse, ambient, slowly evolving texture with dominant coherence',
      regime: { coherent: 0.60, evolving: 0.30, exploring: 0.10 },
      coupling: { strength: [0.2, 0.5], density: 0.15, antagonismThreshold: -0.35 },
      trust: { concentration: 0.7, dominantCap: 1.8, starvationFloor: 0.8 },
      tension: { shape: 'flat', floor: 0.15, ceiling: 0.45 },
      energy: { densityTarget: 0.35, flickerRange: [0.02, 0.08] },
      phase: { lockBias: 0.6, layerIndependence: 0.3 },
    },

    tense: {
      name: 'tense',
      description: 'Building pressure with competitive trust and ascending tension',
      regime: { coherent: 0.30, evolving: 0.50, exploring: 0.20 },
      coupling: { strength: [0.5, 0.8], density: 0.30, antagonismThreshold: -0.25 },
      trust: { concentration: 0.5, dominantCap: 1.6, starvationFloor: 0.6 },
      tension: { shape: 'ascending', floor: 0.40, ceiling: 0.90 },
      energy: { densityTarget: 0.55, flickerRange: [0.05, 0.15] },
      phase: { lockBias: 0.4, layerIndependence: 0.5 },
    },

    chaotic: {
      name: 'chaotic',
      description: 'Volatile, dense, maximally exploring with aggressive antagonism',
      regime: { coherent: 0.15, evolving: 0.35, exploring: 0.50 },
      coupling: { strength: [0.7, 1.0], density: 0.50, antagonismThreshold: -0.15 },
      trust: { concentration: 0.3, dominantCap: 1.4, starvationFloor: 0.4 },
      tension: { shape: 'erratic', floor: 0.20, ceiling: 0.95 },
      energy: { densityTarget: 0.75, flickerRange: [0.10, 0.30] },
      phase: { lockBias: 0.2, layerIndependence: 0.8 },
    },

    meditative: {
      name: 'meditative',
      description: 'Deeply coherent, minimal density, locked layers, very slow evolution',
      regime: { coherent: 0.75, evolving: 0.20, exploring: 0.05 },
      coupling: { strength: [0.1, 0.4], density: 0.10, antagonismThreshold: -0.40 },
      trust: { concentration: 0.8, dominantCap: 1.9, starvationFloor: 0.9 },
      tension: { shape: 'flat', floor: 0.05, ceiling: 0.30 },
      energy: { densityTarget: 0.25, flickerRange: [0.01, 0.05] },
      phase: { lockBias: 0.8, layerIndependence: 0.2 },
    },

    volatile: {
      name: 'volatile',
      description: 'Maximum exploring, independent layers, sharp tension spikes',
      regime: { coherent: 0.10, evolving: 0.30, exploring: 0.60 },
      coupling: { strength: [0.6, 0.9], density: 0.40, antagonismThreshold: -0.10 },
      trust: { concentration: 0.2, dominantCap: 1.3, starvationFloor: 0.3 },
      tension: { shape: 'sawtooth', floor: 0.10, ceiling: 0.85 },
      energy: { densityTarget: 0.60, flickerRange: [0.08, 0.25] },
      phase: { lockBias: 0.1, layerIndependence: 0.9 },
    },
  };

  return {
    get(name) {
      return profiles[name] || null;
    },
    list() {
      return Object.keys(profiles);
    },
    all() {
      return { ...profiles };
    },
  };
})();

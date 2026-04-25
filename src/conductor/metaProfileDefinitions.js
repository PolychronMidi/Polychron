// metaProfileDefinitions.js -- Built-in metaprofile definitions.
// Each profile configures relationship-layer targets that meta-controllers
// self-calibrate toward. Controllers not mentioned use their existing defaults.
//
// The `default` profile encodes scaleFactor() neutral points -- the implicit
// baseline that every other profile is normalised against. Controllers divide
// activeProfile values by default profile values to get a multiplier on their
// own _BASE constants. Single source of truth: change a baseline here, all
// controller scaling stays coherent.

metaProfileDefinitions = (() => {
  const V = validator.create('metaProfileDefinitions');

  // Schema. 'pair' = 2-element finite-number array (lo, hi with lo <= hi).
  // Profiles must declare every key; unknown keys are rejected.
  const _AXIS_SCHEMAS = {
    regime:   { coherent: 'number', evolving: 'number', exploring: 'number' },
    coupling: { strength: 'pair', density: 'number', antagonismThreshold: 'number' },
    trust:    { concentration: 'number', dominantCap: 'number', starvationFloor: 'number' },
    tension:  { shape: 'string', floor: 'number', ceiling: 'number' },
    energy:   { densityTarget: 'number', flickerRange: 'pair' },
    phase:    { lockBias: 'number', layerIndependence: 'number' },
  };

  const _TENSION_SHAPES = ['flat', 'ascending', 'arch', 'sawtooth', 'erratic'];
  const _SECTION_TYPES  = ['intro', 'opening', 'exposition', 'development', 'climax', 'resolution', 'conclusion', 'coda'];

  const profiles = {
    // Neutral baseline. scaleFactor(axis, key) divides active/default; this
    // profile's values are the implicit "1.0x" reference for every controller.
    // Excluded from rotation via empty sectionAffinity. Pickable explicitly
    // via setActive('default') for a controlled "no behavioural change" run.
    default: {
      name: 'default',
      description: 'Neutral baseline - scaleFactor reference, no behavioural shift',
      // Regime values are NOT used for scaling (regime is replacement, not scale).
      // They define what activating 'default' would produce as a regime distribution;
      // they sum to 1.0 per the schema convention shared with the other profiles.
      regime: { coherent: 0.40, evolving: 0.20, exploring: 0.40 },
      coupling: { strength: [0.3, 0.7], density: 0.25, antagonismThreshold: -0.25 },
      trust: { concentration: 0.5, dominantCap: 1.8, starvationFloor: 0.8 },
      tension: { shape: 'arch', floor: 0.20, ceiling: 0.80 },
      energy: { densityTarget: 0.50, flickerRange: [0.04, 0.15] },
      phase: { lockBias: 0.5, layerIndependence: 0.5 },
      sectionAffinity: [],
      minDwellSections: 1,
    },

    atmospheric: {
      name: 'atmospheric',
      description: 'Sparse, ambient, slowly evolving texture with dominant coherence',
      regime: { coherent: 0.60, evolving: 0.30, exploring: 0.10 },
      coupling: { strength: [0.2, 0.5], density: 0.15, antagonismThreshold: -0.35 },
      trust: { concentration: 0.7, dominantCap: 1.8, starvationFloor: 0.8 },
      tension: { shape: 'flat', floor: 0.15, ceiling: 0.45 },
      energy: { densityTarget: 0.35, flickerRange: [0.02, 0.08] },
      phase: { lockBias: 0.6, layerIndependence: 0.3 },
      sectionAffinity: ['intro', 'exposition', 'resolution', 'conclusion', 'coda'],
      minDwellSections: 2,
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
      sectionAffinity: ['exposition', 'development', 'resolution'],
      minDwellSections: 1,
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
      sectionAffinity: ['development', 'climax'],
      minDwellSections: 1,
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
      sectionAffinity: ['intro', 'conclusion', 'coda'],
      minDwellSections: 3,
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
      sectionAffinity: ['climax'],
      minDwellSections: 1,
    },
  };

  function _validatePair(profileName, axis, key, value) {
    const arr = V.assertArray(value, `${profileName}.${axis}.${key}`);
    if (arr.length !== 2) {
      throw new Error(`metaProfileDefinitions: profile "${profileName}" axis "${axis}.${key}" must be a 2-element array, got length ${arr.length}`);
    }
    V.assertFinite(arr[0], `${profileName}.${axis}.${key}[0]`);
    V.assertFinite(arr[1], `${profileName}.${axis}.${key}[1]`);
    if (arr[0] > arr[1]) {
      throw new Error(`metaProfileDefinitions: profile "${profileName}" axis "${axis}.${key}" lo (${arr[0]}) > hi (${arr[1]})`);
    }
  }

  function _validateProfile(name, profile) {
    V.assertPlainObject(profile, name);
    V.assertNonEmptyString(profile.name, `${name}.name`);
    V.assertNonEmptyString(profile.description, `${name}.description`);
    if (profile.name !== name) {
      throw new Error(`metaProfileDefinitions: key "${name}" disagrees with profile.name "${profile.name}"`);
    }

    for (const axis of Object.keys(_AXIS_SCHEMAS)) {
      const section = V.assertPlainObject(profile[axis], `${name}.${axis}`);
      const schema = _AXIS_SCHEMAS[axis];
      for (const declaredKey of Object.keys(section)) {
        if (!(declaredKey in schema)) {
          throw new Error(`metaProfileDefinitions: profile "${name}" axis "${axis}" has unknown key "${declaredKey}"`);
        }
      }
      V.assertKeysPresent(section, Object.keys(schema), `${name}.${axis}`);
      for (const [k, expectedType] of Object.entries(schema)) {
        const label = `${name}.${axis}.${k}`;
        const v = section[k];
        if (expectedType === 'pair') {
          _validatePair(name, axis, k, v);
        } else if (expectedType === 'number') {
          V.assertFinite(v, label);
        } else if (expectedType === 'string') {
          V.assertNonEmptyString(v, label);
        }
      }
    }

    // Semantic checks: regime sums to 1.0, tension shape is known, floor < ceiling.
    const r = profile.regime;
    const sum = r.coherent + r.evolving + r.exploring;
    if (m.abs(sum - 1.0) > 1e-3) {
      throw new Error(`metaProfileDefinitions: profile "${name}" regime targets sum to ${sum.toFixed(4)}, must sum to 1.0`);
    }
    V.assertInSet(profile.tension.shape, new Set(_TENSION_SHAPES), `${name}.tension.shape`);
    if (profile.tension.floor >= profile.tension.ceiling) {
      throw new Error(`metaProfileDefinitions: profile "${name}" tension.floor (${profile.tension.floor}) >= ceiling (${profile.tension.ceiling})`);
    }

    // Affinity / dwell.
    const affinity = V.assertArray(profile.sectionAffinity, `${name}.sectionAffinity`);
    const knownSections = new Set(_SECTION_TYPES);
    for (let i = 0; i < affinity.length; i++) {
      V.assertInSet(affinity[i], knownSections, `${name}.sectionAffinity[${i}]`);
    }
    const dwell = V.assertFinite(profile.minDwellSections, `${name}.minDwellSections`);
    if (dwell < 1) {
      throw new Error(`metaProfileDefinitions: profile "${name}" minDwellSections (${dwell}) must be >= 1`);
    }

    // Derived: coupling midpoint -- precomputed so scaleFactor('coupling','midpoint') is uniform.
    profile.coupling.midpoint = (profile.coupling.strength[0] + profile.coupling.strength[1]) / 2;
  }

  for (const [name, profile] of Object.entries(profiles)) {
    _validateProfile(name, profile);
  }

  function bySection(sectionType) {
    const matches = [];
    for (const name of Object.keys(profiles)) {
      if (profiles[name].sectionAffinity.includes(sectionType)) matches.push(name);
    }
    return matches;
  }

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
    bySection,
  };
})();

// metaProfileDefinitions.js -- Built-in metaprofile definitions.
// Each profile configures relationship-layer targets that meta-controllers
// self-calibrate toward. Controllers not mentioned use their existing defaults.
//
// The `default` profile encodes scaleFactor() neutral points -- the implicit
// baseline that every other profile is normalised against. Controllers divide
// activeProfile values by default profile values to get a multiplier on their
// own _BASE constants. Single source of truth: change a baseline here, all
// controller scaling stays coherent.

moduleLifecycle.declare({
  name: 'metaProfileDefinitions',
  subsystem: 'conductor',
  deps: ['validator'],
  provides: ['metaProfileDefinitions'],
  init: (deps) => {
  const V = deps.validator.create('metaProfileDefinitions');

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

  // Optional axis: composerFamilies is a free-form map of family-name to
  // weight multiplier. NOT in _AXIS_SCHEMAS because its keys are dynamic
  // (any family declared in COMPOSER_FAMILIES is valid). When present,
  // factoryFamilies.getComposerFamiliesOrFail multiplies its computed
  // weight by composerFamilies[familyName] (default 1.0). Lets a
  // metaprofile actively bias which composers play, not just how loud --
  // the substrate-level move that pushes metaprofiles past decoration.

  const _TENSION_SHAPES = ['flat', 'ascending', 'descending', 'arch', 'sawtooth', 'erratic'];
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
      // Tension ceiling itself ascends across the activation: 0.70 -> 0.90.
      // Combined with `shape: 'ascending'` (the per-section curve), the
      // effective ceiling rises during the section AND across sections,
      // doubling the "building pressure" character. Controllers wanting
      // mid-progress resolution call metaProfiles.getAxisValueAt('tension',
      // 'ceiling', fallback, progress).
      tension: { shape: 'ascending', floor: 0.40, ceiling: { from: 0.70, to: 0.90, curve: 'ascending' } },
      energy: { densityTarget: 0.55, flickerRange: [0.05, 0.15] },
      phase: { lockBias: 0.4, layerIndependence: 0.5 },
      sectionAffinity: ['exposition', 'development', 'resolution'],
      // dwell=2 (was 1) so the tension.ceiling envelope actually traverses
      // its from->to range across the activation. With dwell=1 the
      // envelope was functionally dormant (progress always ~0). Holding
      // for 2 sections gives audible build: section 0 of activation
      // ceiling=0.70, section 1 ceiling=0.90.
      minDwellSections: 2,
    },

    chaotic: {
      name: 'chaotic',
      description: 'Volatile, dense, maximally exploring with aggressive antagonism',
      regime: { coherent: 0.15, evolving: 0.35, exploring: 0.50 },
      coupling: { strength: [0.7, 1.0], density: 0.50, antagonismThreshold: -0.15 },
      trust: { concentration: 0.3, dominantCap: 1.4, starvationFloor: 0.4 },
      tension: { shape: 'erratic', floor: 0.20, ceiling: 0.95 },
      // Substrate-level: bias the composer pool toward developmental and
      // rhythmic-drive families; dampen diatonicCore. Pair with conductor
      // profiles that match the chaotic character; antipathic to settled
      // ones. Coupling-topology hint: chaotic favors entropy-bearing pairs.
      composerFamilies: { development: 1.6, rhythmicDrive: 1.4, tonalExploration: 1.2, harmonicMotion: 0.9, diatonicCore: 0.6 },
      conductorAffinity: ['explosive'],
      conductorAntipathy: ['atmospheric', 'minimal'],
      couplingPairs: [['density', 'entropy'], ['flicker', 'entropy'], ['tension', 'flicker']],
      // Density target as a stochastic distribution -- per-tick samples
      // give organic micro-jitter without manual flicker code. cv ~0.08 =
      // moderate variance; controllers wanting samples call
      // metaProfiles.sampledScaleFactor('energy','densityTarget') instead
      // of scaleFactor (which collapses to mean for determinism).
      energy: { densityTarget: { mean: 0.75, std: 0.06 }, flickerRange: [0.10, 0.30] },
      phase: { lockBias: 0.2, layerIndependence: 0.8 },
      sectionAffinity: ['development', 'climax'],
      minDwellSections: 1,
      // Reactive trigger: when systemDynamicsProfiler reports high coupling
      // strength, surface chaotic as the recommended profile via
      // metaProfiles.evaluateTriggers(snapshot). Signal name matches a real
      // top-level field on systemDynamicsProfiler.getSnapshot() so rotators
      // can pass that snapshot directly. The rotator (main.js) does not
      // auto-honor it yet -- this declaration is the schema-validated
      // foothold that downstream rotation logic can opt into.
      triggers: {
        enter: [
          { if: 'couplingStrength > 0.7', priority: 80 },
        ],
      },
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
      // Substrate-level: bias toward harmonic motion and diatonic core;
      // dampen rhythmic-drive and development. Freeze pair-gain ceilings
      // (`pair_gain_ceiling`) so coupling can't escalate during the
      // calmest profile. Also nominally disables `antagonism_bridges`
      // (Python-side; consumed via metaprofile-active.json). Conductor
      // pairing favors ambient profiles.
      composerFamilies: { harmonicMotion: 1.4, diatonicCore: 1.3, tonalExploration: 1.0, development: 0.6, rhythmicDrive: 0.5 },
      conductorAffinity: ['atmospheric', 'minimal'],
      conductorAntipathy: ['explosive'],
      disableControllers: ['antagonism_bridges', 'pair_gain_ceiling'],
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

    elegiac: {
      name: 'elegiac',
      description: 'Coherent, low-density, descending tension -- release / denouement / coda',
      regime: { coherent: 0.65, evolving: 0.30, exploring: 0.05 },
      coupling: { strength: [0.3, 0.6], density: 0.20, antagonismThreshold: -0.30 },
      trust: { concentration: 0.75, dominantCap: 1.85, starvationFloor: 0.85 },
      tension: { shape: 'descending', floor: 0.20, ceiling: 0.55 },
      energy: { densityTarget: 0.30, flickerRange: [0.03, 0.10] },
      phase: { lockBias: 0.7, layerIndependence: 0.3 },
      sectionAffinity: ['resolution', 'conclusion', 'coda'],
      minDwellSections: 2,
      // Substrate: bias toward harmonicMotion + tonalExploration for the
      // descending-release character. Dampen rhythmic-drive and
      // development -- elegy is reflective, not propulsive.
      composerFamilies: { harmonicMotion: 1.4, tonalExploration: 1.3, diatonicCore: 1.1, development: 0.7, rhythmicDrive: 0.5 },
      conductorAffinity: ['atmospheric'],
    },

    anthemic: {
      name: 'anthemic',
      description: 'High coherent + high coupling, ascending arch -- locked-step shared peak',
      regime: { coherent: 0.50, evolving: 0.40, exploring: 0.10 },
      coupling: { strength: [0.6, 0.9], density: 0.40, antagonismThreshold: -0.20 },
      trust: { concentration: 0.6, dominantCap: 1.7, starvationFloor: 0.7 },
      tension: { shape: 'arch', floor: 0.35, ceiling: 0.85 },
      energy: { densityTarget: 0.65, flickerRange: [0.05, 0.18] },
      phase: { lockBias: 0.7, layerIndependence: 0.3 },
      // Substrate-level: anthemic biases harmonic motion and diatonic core
      // for the locked-step shared peak character. Pairs with structurally
      // strong conductor profiles. Coupling pairs favor density-tension and
      // tension-flicker for a coordinated build.
      composerFamilies: { harmonicMotion: 1.5, diatonicCore: 1.4, rhythmicDrive: 1.2, development: 0.9, tonalExploration: 0.8 },
      conductorAffinity: ['explosive', 'atmospheric'],
      couplingPairs: [['density', 'tension'], ['tension', 'flicker']],
      sectionAffinity: ['climax', 'resolution'],
      minDwellSections: 2,
    },

    // == Sample subvariants demonstrating inheritance + composition ==
    // Inheritance: copy parent's axes, override only what's different.
    atmospheric_warm: {
      name: 'atmospheric_warm',
      description: 'Atmospheric with warmer trust ecology (higher dominant cap)',
      inherits: 'atmospheric',
      trust: { concentration: 0.7, dominantCap: 1.95, starvationFloor: 0.85 },
      sectionAffinity: ['intro', 'exposition'],
      minDwellSections: 2,
    },

    // Per-layer split: L1 carries anthemic character (locked-step build),
    // L2 carries elegiac character (descending release). The two
    // polyrhythmic layers run different metaprofile axes simultaneously
    // -- L1's composer pool, axes, and trust ecology come from anthemic;
    // L2's from elegiac. Substrate-level demonstration of layerVariants:
    // factoryFamilies.getComposerFamiliesOrFail consults
    // metaProfiles.getComposerFamilyWeightForLayer using LM.activeLayer
    // to resolve the correct variant per layer.
    polyrhythmic_split: {
      name: 'polyrhythmic_split',
      description: 'L1 builds (anthemic) while L2 releases (elegiac) -- truly polyrhythmic emotional layers',
      compose: {
        regime: 'anthemic',
        coupling: 'anthemic',
        trust: 'anthemic',
        tension: 'anthemic',
        energy: 'anthemic',
        phase: 'anthemic',
      },
      sectionAffinity: ['climax', 'resolution'],
      minDwellSections: 2,
      layerVariants: { L1: 'anthemic', L2: 'elegiac' },
    },

    // Per-axis composition: pull each axis from a different parent.
    meditative_climax: {
      name: 'meditative_climax',
      description: 'Meditative regime + anthemic coupling/tension -- restrained crescendo',
      compose: {
        regime: 'meditative',
        coupling: 'anthemic',
        trust: 'meditative',
        tension: 'anthemic',
        energy: 'anthemic',
        phase: 'meditative',
      },
      sectionAffinity: ['climax'],
      minDwellSections: 2,
    },
  };

  // Inheritance + per-axis composition resolver. Walks parent + compose
  // pointers to materialize a fully-specified profile from a sparse
  // declaration. Single-level only (parents must themselves be already
  // resolved at the time the child is processed) -- runs in declaration
  // order, so authors must define parents before children.
  //
  // Resolution rules:
  //   1. If `inherits: 'name'` set, start with deep-copy of that profile's axes.
  //   2. If `compose: { axisName: 'sourceProfile' }` set, replace each named
  //      axis with the source profile's axis values.
  //   3. Apply this profile's directly-declared axis values as final overrides.
  //   4. Copy meta fields (name, description, sectionAffinity, minDwellSections)
  //      from the raw profile; never inherit those.
  //
  // Cycle detection: a profile cannot inherit from or compose itself.
  // Forward reference detection: parent must already be resolved.
  const _AXES = Object.keys(_AXIS_SCHEMAS);
  function _deepCopyAxis(value) {
    if (Array.isArray(value)) return value.slice();
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = Array.isArray(v) ? v.slice() : v;
      return out;
    }
    return value;
  }
  function _resolveProfile(name, raw, resolvedSoFar) {
    const out = { name: raw.name || name, description: raw.description || '' };
    // Step 1: inherit base axes.
    if (raw.inherits) {
      if (raw.inherits === name) {
        throw new Error(`metaProfileDefinitions: profile "${name}" cannot inherit from itself`);
      }
      const parent = resolvedSoFar[raw.inherits];
      if (!parent) {
        throw new Error(`metaProfileDefinitions: profile "${name}" inherits from "${raw.inherits}" which is not yet defined (declare parents before children)`);
      }
      for (const axis of _AXES) {
        if (parent[axis]) out[axis] = _deepCopyAxis(parent[axis]);
      }
    }
    // Step 2: per-axis composition.
    if (raw.compose && typeof raw.compose === 'object') {
      for (const [axis, sourceName] of Object.entries(raw.compose)) {
        if (!_AXIS_SCHEMAS[axis]) {
          throw new Error(`metaProfileDefinitions: profile "${name}" compose has unknown axis "${axis}"`);
        }
        if (sourceName === name) {
          throw new Error(`metaProfileDefinitions: profile "${name}" compose.${axis} cannot reference itself`);
        }
        const source = resolvedSoFar[sourceName];
        if (!source) {
          throw new Error(`metaProfileDefinitions: profile "${name}" compose.${axis} references "${sourceName}" which is not yet defined`);
        }
        if (!source[axis]) {
          throw new Error(`metaProfileDefinitions: profile "${name}" compose.${axis} from "${sourceName}" -- source profile lacks "${axis}" axis`);
        }
        out[axis] = _deepCopyAxis(source[axis]);
      }
    }
    // Step 3: direct axis overrides from the raw profile.
    for (const axis of _AXES) {
      if (raw[axis] !== undefined) {
        if (out[axis]) {
          // Merge: child keys win, parent keys preserved for unspecified.
          out[axis] = { ..._deepCopyAxis(out[axis]), ..._deepCopyAxis(raw[axis]) };
        } else {
          out[axis] = _deepCopyAxis(raw[axis]);
        }
      }
    }
    // Step 4: meta fields -- never inherited, must be on the child.
    if (raw.sectionAffinity !== undefined) out.sectionAffinity = raw.sectionAffinity.slice();
    else if (resolvedSoFar[raw.inherits]) out.sectionAffinity = resolvedSoFar[raw.inherits].sectionAffinity.slice();
    else out.sectionAffinity = [];
    if (raw.minDwellSections !== undefined) out.minDwellSections = raw.minDwellSections;
    else if (resolvedSoFar[raw.inherits]) out.minDwellSections = resolvedSoFar[raw.inherits].minDwellSections;
    else out.minDwellSections = 1;
    // Reactive triggers -- optional. Inherited from parent if not declared.
    if (raw.triggers !== undefined) out.triggers = raw.triggers;
    else if (resolvedSoFar[raw.inherits] && resolvedSoFar[raw.inherits].triggers) out.triggers = resolvedSoFar[raw.inherits].triggers;
    // Substrate-level optional fields -- same inheritance semantics as
    // triggers (use child if declared, parent otherwise).
    for (const k of ['composerFamilies', 'conductorAffinity', 'conductorAntipathy', 'layerVariants', 'sectionArc', 'disableControllers', 'couplingPairs']) {
      if (raw[k] !== undefined) out[k] = raw[k];
      else if (resolvedSoFar[raw.inherits] && resolvedSoFar[raw.inherits][k] !== undefined) out[k] = resolvedSoFar[raw.inherits][k];
    }
    return out;
  }

  // Validate reactive-trigger declarations. Optional; profile without triggers
  // remains valid. Trigger schema:
  //   triggers: {
  //     enter: [{ if: '<signal> <op> <value>', priority?: number }, ...],
  //     exit:  [{ if: '<signal> <op> <value>', goto: '<profileName>' }, ...],
  //   }
  // op in {>, <, >=, <=, ==}. Signal is any key in the snapshot passed to
  // evaluateTriggers. Priority is a non-negative integer (default 50).
  // Validate the optional substrate-level fields. Each one is independently
  // optional; profile remains valid if all are absent.
  function _validateOptionalSubstrate(name, profile) {
    // composerFamilies: { familyName: weightMultiplier } -- biases composer
    // pool selection.
    if (profile.composerFamilies !== undefined) {
      V.assertPlainObject(profile.composerFamilies, `${name}.composerFamilies`);
      for (const [k, v] of Object.entries(profile.composerFamilies)) {
        V.assertNonEmptyString(k, `${name}.composerFamilies key`);
        V.assertFinite(v, `${name}.composerFamilies.${k}`);
        if (v < 0) {
          throw new Error(`metaProfileDefinitions: profile "${name}" composerFamilies.${k} must be >= 0`);
        }
      }
    }
    // conductorAffinity / conductorAntipathy: string[] -- preferred / avoided
    // conductor profile names.
    for (const k of ['conductorAffinity', 'conductorAntipathy']) {
      if (profile[k] !== undefined) {
        V.assertArray(profile[k], `${name}.${k}`);
        for (let i = 0; i < profile[k].length; i++) {
          V.assertNonEmptyString(profile[k][i], `${name}.${k}[${i}]`);
        }
      }
    }
    // layerVariants: { L1: profileName, L2: profileName } -- per-layer
    // metaprofile assignment when this profile activates.
    if (profile.layerVariants !== undefined) {
      V.assertPlainObject(profile.layerVariants, `${name}.layerVariants`);
      for (const [layer, variant] of Object.entries(profile.layerVariants)) {
        if (layer !== 'L1' && layer !== 'L2') {
          throw new Error(`metaProfileDefinitions: profile "${name}" layerVariants key "${layer}" must be 'L1' or 'L2'`);
        }
        V.assertNonEmptyString(variant, `${name}.layerVariants.${layer}`);
      }
    }
    // sectionArc: string[] -- override the structural section sequence.
    if (profile.sectionArc !== undefined) {
      V.assertArray(profile.sectionArc, `${name}.sectionArc`);
      const known = new Set(_SECTION_TYPES);
      for (let i = 0; i < profile.sectionArc.length; i++) {
        V.assertInSet(profile.sectionArc[i], known, `${name}.sectionArc[${i}]`);
      }
    }
    // disableControllers: string[] -- subtractive subsystem silencing.
    if (profile.disableControllers !== undefined) {
      V.assertArray(profile.disableControllers, `${name}.disableControllers`);
      for (let i = 0; i < profile.disableControllers.length; i++) {
        V.assertNonEmptyString(profile.disableControllers[i], `${name}.disableControllers[${i}]`);
      }
    }
    // couplingPairs: [[axisA, axisB], ...] -- prescribed coupling topology.
    if (profile.couplingPairs !== undefined) {
      V.assertArray(profile.couplingPairs, `${name}.couplingPairs`);
      for (let i = 0; i < profile.couplingPairs.length; i++) {
        const pair = profile.couplingPairs[i];
        V.assertArray(pair, `${name}.couplingPairs[${i}]`);
        if (pair.length !== 2) {
          throw new Error(`metaProfileDefinitions: profile "${name}" couplingPairs[${i}] must have length 2, got ${pair.length}`);
        }
        V.assertNonEmptyString(pair[0], `${name}.couplingPairs[${i}][0]`);
        V.assertNonEmptyString(pair[1], `${name}.couplingPairs[${i}][1]`);
      }
    }
  }

  function _validateTriggers(name, triggers) {
    if (triggers === undefined || triggers === null) return;
    V.assertPlainObject(triggers, `${name}.triggers`);
    for (const lifecycle of ['enter', 'exit']) {
      const arr = triggers[lifecycle];
      if (arr === undefined) continue;
      V.assertArray(arr, `${name}.triggers.${lifecycle}`);
      for (let i = 0; i < arr.length; i++) {
        const trig = arr[i];
        V.assertPlainObject(trig, `${name}.triggers.${lifecycle}[${i}]`);
        V.assertNonEmptyString(trig.if, `${name}.triggers.${lifecycle}[${i}].if`);
        // Parse and reject obviously malformed expressions early.
        const parsed = _parseTriggerExpr(trig.if);
        if (!parsed) {
          throw new Error(`metaProfileDefinitions: profile "${name}" triggers.${lifecycle}[${i}] expression "${trig.if}" not parseable (expected '<signal> <op> <value>')`);
        }
        if (lifecycle === 'enter' && trig.priority !== undefined) {
          V.assertFinite(trig.priority, `${name}.triggers.enter[${i}].priority`);
        }
        if (lifecycle === 'exit' && trig.goto !== undefined) {
          V.assertNonEmptyString(trig.goto, `${name}.triggers.exit[${i}].goto`);
        }
      }
    }
  }

  // Parse `<signal> <op> <value>` -> {signal, op, value}. Returns null on
  // syntax error. Accepts ops: > >= < <= == != . Value may be number or
  // 'true'/'false'.
  const _OPS = ['>=', '<=', '!=', '==', '>', '<'];
  function _parseTriggerExpr(expr) {
    const s = String(expr).trim();
    for (const op of _OPS) {
      const idx = s.indexOf(op);
      if (idx < 0) continue;
      const signal = s.slice(0, idx).trim();
      const valueStr = s.slice(idx + op.length).trim();
      if (!signal || !valueStr) return null;
      let value;
      if (valueStr === 'true') value = true;
      else if (valueStr === 'false') value = false;
      else {
        const n = Number(valueStr);
        if (Number.isFinite(n)) {
          value = n;
        } else {
          return null;
        }
      }
      return { signal, op, value };
    }
    return null;
  }

  function _evalTriggerExpr(parsed, snapshot) {
    const v = snapshot ? snapshot[parsed.signal] : undefined;
    if (v === undefined) return false;
    switch (parsed.op) {
      case '>':  return v >  parsed.value;
      case '<':  return v <  parsed.value;
      case '>=': return v >= parsed.value;
      case '<=': return v <= parsed.value;
      case '==': return v === parsed.value;
      case '!=': return v !== parsed.value;
    }
    return false;
  }

  // Time-varying axis values: an envelope `{from, to, curve?}` interpolates
  // across the profile's activation. Curve is one of: 'linear' (default),
  // 'arch', 'ascending', 'descending'. Schema validator accepts either the
  // raw scalar/pair OR an envelope of the corresponding shape.
  function _isEnvelope(v) {
    if (v === null || v === undefined) return false;
    if (Array.isArray(v)) return false;
    // Plain-object envelope shape probe -- not validated input, just a tag check.
    if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return false;
    return Object.prototype.hasOwnProperty.call(v, 'from')
      && Object.prototype.hasOwnProperty.call(v, 'to');
  }

  function _isDistribution(v) {
    if (v === null || v === undefined) return false;
    if (Array.isArray(v)) return false;
    if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return false;
    return Object.prototype.hasOwnProperty.call(v, 'mean')
      && Object.prototype.hasOwnProperty.call(v, 'std');
  }

  function _validateDistribution(profileName, axis, key, value) {
    V.assertFinite(value.mean, `${profileName}.${axis}.${key}.mean`);
    V.assertFinite(value.std, `${profileName}.${axis}.${key}.std`);
    if (value.std < 0) {
      throw new Error(`metaProfileDefinitions: profile "${profileName}" axis "${axis}.${key}" std must be >= 0, got ${value.std}`);
    }
    if (value.skew !== undefined) {
      V.assertFinite(value.skew, `${profileName}.${axis}.${key}.skew`);
    }
  }

  function _validateNumberOrEnvelope(profileName, axis, key, value) {
    if (_isEnvelope(value)) {
      V.assertFinite(value.from, `${profileName}.${axis}.${key}.from`);
      V.assertFinite(value.to, `${profileName}.${axis}.${key}.to`);
      if (value.curve !== undefined) {
        V.assertInSet(value.curve, new Set(['linear', 'arch', 'ascending', 'descending']),
          `${profileName}.${axis}.${key}.curve`);
      }
    } else if (_isDistribution(value)) {
      _validateDistribution(profileName, axis, key, value);
    } else {
      V.assertFinite(value, `${profileName}.${axis}.${key}`);
    }
  }

  function _validatePairOrEnvelope(profileName, axis, key, value) {
    if (_isEnvelope(value)) {
      _validatePair(profileName, axis, `${key}.from`, value.from);
      _validatePair(profileName, axis, `${key}.to`, value.to);
      if (value.curve !== undefined) {
        V.assertInSet(value.curve, new Set(['linear', 'arch', 'ascending', 'descending']),
          `${profileName}.${axis}.${key}.curve`);
      }
    } else {
      _validatePair(profileName, axis, key, value);
    }
  }

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
      // Derived keys are added BY the validator after schema check (e.g.
      // coupling.midpoint), so they survive inheritance copies. Skip them
      // in the unknown-key sanity check; the schema is still the authority
      // for what authors must declare.
      const _DERIVED_KEYS = new Set(['midpoint']);
      for (const declaredKey of Object.keys(section)) {
        if (_DERIVED_KEYS.has(declaredKey)) continue;
        if (!(declaredKey in schema)) {
          throw new Error(`metaProfileDefinitions: profile "${name}" axis "${axis}" has unknown key "${declaredKey}"`);
        }
      }
      V.assertKeysPresent(section, Object.keys(schema), `${name}.${axis}`);
      for (const [k, expectedType] of Object.entries(schema)) {
        const label = `${name}.${axis}.${k}`;
        const v = section[k];
        if (expectedType === 'pair') {
          _validatePairOrEnvelope(name, axis, k, v);
        } else if (expectedType === 'number') {
          _validateNumberOrEnvelope(name, axis, k, v);
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

    // Reactive triggers -- optional. Validates schema if present.
    _validateTriggers(name, profile.triggers);

    // Substrate-level optional fields. Each one moves metaprofiles from
    // "scaling layer" toward "structural layer" by declaring something
    // the controllers actively consult, not just multiply.
    _validateOptionalSubstrate(name, profile);

    // Derived: coupling midpoint -- precomputed so scaleFactor('coupling','midpoint') is uniform.
    // Skip when strength is an envelope (non-array shape); in that case
    // scaleFactor('coupling','midpoint') falls back to envelope-resolution
    // via the runtime accessors.
    if (Array.isArray(profile.coupling.strength)) {
      profile.coupling.midpoint = (profile.coupling.strength[0] + profile.coupling.strength[1]) / 2;
    }
  }

  // Resolution pass: materialize sparse declarations (those using
  // `inherits` and/or `compose`) into fully-specified profiles BEFORE
  // schema validation runs. Iteration is in declaration order; a child
  // referencing a not-yet-resolved parent throws.
  const _resolved = {};
  for (const [name, raw] of Object.entries(profiles)) {
    _resolved[name] = _resolveProfile(name, raw, _resolved);
    profiles[name] = _resolved[name];
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

  // Three-scope custom-profile loader. Reads project + global directories,
  // resolves inheritance/composition (parent must already exist in
  // `profiles` -- built-ins or earlier-loaded customs), validates, registers.
  // Conflict resolution: project beats global; built-ins are baseline (a
  // custom profile with the same name overrides the built-in). Returns
  // an array of newly-registered names.
  //
  // File layout:
  //   <project>/.hme/metaprofiles/*.json    (project scope; commit this)
  //   ~/.hme/metaprofiles/*.json            (user-global)
  // Each file is either a single profile object, or an array of them.
  function loadCustomProfiles() {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const projectRoot = process.env.PROJECT_ROOT || '/home/jah/Polychron';
    // User-scope (~/.hme) loaded first; project-scope (.hme/) loaded second
    // and overrides user-scope on name collision. Built-ins are baseline.
    const dirs = [
      path.join(os.homedir(), '.hme', 'metaprofiles'),
      path.join(projectRoot, '.hme', 'metaprofiles'),
    ];
    const registered = [];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
      for (const f of files) {
        const fpath = path.join(dir, f);
        let raw;
        try { raw = JSON.parse(fs.readFileSync(fpath, 'utf8')); }
        catch (err) {
          throw new Error(`metaProfileDefinitions: custom profile ${fpath} parse failed: ${err.message}`);
        }
        const list = Array.isArray(raw) ? raw : [raw];
        for (const decl of list) {
          V.assertPlainObject(decl, `customProfile@${fpath}`);
          V.assertNonEmptyString(decl.name, `customProfile@${fpath}.name`);
          const resolved = _resolveProfile(decl.name, decl, profiles);
          _validateProfile(decl.name, resolved);
          profiles[decl.name] = resolved;
          registered.push(decl.name);
        }
      }
    }
    return registered;
  }

  // Embedding: turn a profile into a flat numeric vector spanning every
  // axis-key. Distributions collapse to mean; envelopes to (from+to)/2;
  // pair-typed keys contribute both endpoints. Strings (tension.shape)
  // map through a fixed lookup so categorical info still participates.
  // Used by distance() / nearest() to do vector-space reasoning over
  // the profile registry. Excludes 'default' (it's the scaling neutral
  // point, not a profile to compare against in normal operation).
  const _SHAPE_INDEX = { flat: 0, ascending: 1, descending: 2, arch: 3, sawtooth: 4, erratic: 5 };
  function _scalar(v) {
    if (Array.isArray(v)) return (v[0] + v[1]) / 2;
    if (v && typeof v === 'object') {
      if ('mean' in v) return v.mean;
      if ('from' in v && 'to' in v) {
        const a = Array.isArray(v.from) ? (v.from[0] + v.from[1]) / 2 : v.from;
        const b = Array.isArray(v.to)   ? (v.to[0]   + v.to[1])   / 2 : v.to;
        return (a + b) / 2;
      }
    }
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      // Categorical -> ordinal. Currently only tension.shape uses this.
      return _SHAPE_INDEX[v] !== undefined ? _SHAPE_INDEX[v] : 0;
    }
    return 0;
  }

  function axisVector(profileNameOrObject) {
    const profile = typeof profileNameOrObject === 'string'
      ? profiles[profileNameOrObject]
      : profileNameOrObject;
    if (!profile) {
      throw new Error(`metaProfileDefinitions.axisVector: profile "${profileNameOrObject}" not found`);
    }
    const out = [];
    for (const axis of Object.keys(_AXIS_SCHEMAS)) {
      const section = profile[axis];
      if (!section) {
        for (const k of Object.keys(_AXIS_SCHEMAS[axis])) {
          // missing axis still produces zero-padded entries to keep dims aligned
          if (_AXIS_SCHEMAS[axis][k] === 'pair') { out.push(0); out.push(0); }
          else { out.push(0); }
        }
        continue;
      }
      for (const k of Object.keys(_AXIS_SCHEMAS[axis])) {
        const v = section[k];
        if (_AXIS_SCHEMAS[axis][k] === 'pair') {
          if (Array.isArray(v)) { out.push(v[0]); out.push(v[1]); }
          else if (v && typeof v === 'object' && 'from' in v) {
            const a = Array.isArray(v.from) ? v.from[0] : v.from;
            const b = Array.isArray(v.to)   ? v.to[0]   : v.to;
            out.push((a + (Array.isArray(v.from) ? v.from[1] : v.from)) / 2);
            out.push((b + (Array.isArray(v.to)   ? v.to[1]   : v.to)) / 2);
          } else { out.push(0); out.push(0); }
        } else {
          out.push(_scalar(v));
        }
      }
    }
    return out;
  }

  // Cosine distance in axis-vector space. 0 = identical direction,
  // 2 = opposite. Both inputs accepted as profile name or vector.
  function distance(a, b) {
    const va = Array.isArray(a) ? a : axisVector(a);
    const vb = Array.isArray(b) ? b : axisVector(b);
    if (va.length !== vb.length) {
      throw new Error(`metaProfileDefinitions.distance: vector length mismatch ${va.length} vs ${vb.length}`);
    }
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < va.length; i++) {
      dot += va[i] * vb[i];
      na  += va[i] * va[i];
      nb  += vb[i] * vb[i];
    }
    if (na === 0 || nb === 0) return 1;
    return 1 - dot / (m.sqrt(na) * m.sqrt(nb));
  }

  // Top-k nearest profiles to the named one, sorted ascending by cosine
  // distance. Excludes self and 'default'. Used by rotators that prefer
  // smooth transitions between similar profiles over random pivots.
  function nearest(name, k) {
    if (!profiles[name]) {
      throw new Error(`metaProfileDefinitions.nearest: profile "${name}" not found`);
    }
    const target = axisVector(name);
    const ranked = [];
    for (const other of Object.keys(profiles)) {
      if (other === name || other === 'default') continue;
      ranked.push({ name: other, distance: distance(target, axisVector(other)) });
    }
    ranked.sort((a, b) => a.distance - b.distance);
    const limit = V.optionalFinite(k, ranked.length);
    return ranked.slice(0, limit);
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
    loadCustomProfiles,
    axisVector,
    distance,
    nearest,
    // Surface for metaProfiles.evaluateTriggers -- internal helpers, not
    // intended for general consumption.
    _parseTriggerExpr,
    _evalTriggerExpr,
  };
  },
});

// feedbackGraphContract.js - Runtime validation of FEEDBACK_GRAPH.json against live module topology.
// Extracted from mainBootstrap.js for single-responsibility.
// This is a second immune layer beyond lint rules: it proves the declared
// feedback topology still matches live registrations and firewall boundaries.

feedbackGraphContract = (() => {
  const V = validator.create('feedbackGraphContract');

  const validLatencies = ['immediate', 'beat-delayed', 'phrase-delayed', 'section-delayed'];

  /**
   * Module references and their expected method contracts.
   * Maps module name -> global reference, and module name -> required methods.
   * @returns {{ refs: Record<string, object>, methods: Record<string, string[]> }}
   */
  function _getModuleContracts() {
    return {
      refs: {
        coherenceMonitor,
        entropyRegulator,
        adaptiveTrustScores,
        pipelineCouplingManager,
        profileAdaptation,
        regimeReactiveDamping,
        pipelineBalancer,
        dynamicArchitectPlanner
      },
      methods: {
        coherenceMonitor: ['getDensityBias'],
        entropyRegulator: ['regulate'],
        adaptiveTrustScores: ['getSnapshot', 'registerOutcome'],
        pipelineCouplingManager: ['densityBias', 'tensionBias', 'flickerBias'],
        profileAdaptation: ['update', 'getHints'],
        regimeReactiveDamping: ['densityBias', 'tensionBias', 'flickerMod'],
        pipelineBalancer: ['densityBias', 'tensionBias'],
        dynamicArchitectPlanner: ['getTensionBias', 'recordIntensity']
      }
    };
  }

  /**
   * Assert that FEEDBACK_GRAPH.json matches runtime module topology.
   * Throws on any contract violation.
   */
  function assert() {
    const graphPath = path.join(process.cwd(), 'doc', 'FEEDBACK_GRAPH.json');
    if (!fs.existsSync(graphPath)) {
      throw new Error(`feedbackGraphContract: missing FEEDBACK_GRAPH.json at ${graphPath}`);
    }

    let graph;
    try {
      graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    } catch (err) {
      throw new Error(`feedbackGraphContract: FEEDBACK_GRAPH.json parse failed: ${err && err.message ? err.message : err}`);
    }

    if (!graph || typeof graph !== 'object') {
      throw new Error('feedbackGraphContract: FEEDBACK_GRAPH.json must parse to an object');
    }

    const firewalls = graph.firewalls;
    V.assertPlainObject(firewalls, 'firewalls');
    const firewallKeys = Object.keys(firewalls);
    if (firewallKeys.length === 0) {
      throw new Error('feedbackGraphContract: FEEDBACK_GRAPH.json firewalls cannot be empty');
    }

    const loops = graph.feedbackLoops;
    V.assertArray(loops, 'feedbackLoops');
    if (loops.length === 0) {
      throw new Error('feedbackGraphContract: FEEDBACK_GRAPH.json feedbackLoops must be a non-empty array');
    }

    const { refs: moduleRefs, methods: moduleMethodContracts } = _getModuleContracts();

    for (let i = 0; i < loops.length; i++) {
      const loop = loops[i];
      const label = `feedbackLoops[${i}]`;
      if (!loop || typeof loop !== 'object') {
        throw new Error(`feedbackGraphContract: ${label} must be an object`);
      }

      V.assertNonEmptyString(loop.id, `${label}.id`);
      // Module names may be dotted (e.g. "pipelineBalancer.tension") - resolve root global.
      const rawModName = V.assertNonEmptyString(loop.module, `${label}.module`);
      const modName = rawModName.split('.')[0];
      V.assertNonEmptyString(loop.sourceDomain, `${label}.sourceDomain`);
      V.assertNonEmptyString(loop.targetDomain, `${label}.targetDomain`);
      V.assertNonEmptyString(loop.mechanism, `${label}.mechanism`);

      const latency = V.assertNonEmptyString(loop.latency, `${label}.latency`);
      V.requireEnum(latency, validLatencies, `${label}.latency`);

      V.assertArray(loop.firewallsCrossed, `${label}.firewallsCrossed`);
      for (let j = 0; j < loop.firewallsCrossed.length; j++) {
        const firewall = V.assertNonEmptyString(loop.firewallsCrossed[j], `${label}.firewallsCrossed[${j}]`);
        if (!firewallKeys.includes(firewall)) {
          throw new Error(`feedbackGraphContract: ${label} references unknown firewall "${firewall}"`);
        }
      }

      const modRef = moduleRefs[modName];
      V.assertManagerShape(modRef, modName, moduleMethodContracts[modName] || []);
    }

    // Firewall contract: cross-layer modules cannot directly register conductor
    // density/tension/flicker biases. Recorder/stateProvider bridge traffic is allowed.
    const crossLayerNames = new Set(crossLayerRegistry.getRegisteredNames());
    const ciNames = conductorIntelligence.getRegistryNames();
    const forbidden = [];

    ['density', 'tension', 'flicker'].forEach((bucket) => {
      const names = ciNames[bucket];
      for (let i = 0; i < names.length; i++) {
        if (crossLayerNames.has(names[i])) {
          forbidden.push(`${bucket}:${names[i]}`);
        }
      }
    });

    if (forbidden.length > 0) {
      throw new Error(
        'feedbackGraphContract: firewall breach - cross-layer modules registered conductor biases directly: ' +
        forbidden.join(', ')
      );
    }
  }

  return { assert };
})();

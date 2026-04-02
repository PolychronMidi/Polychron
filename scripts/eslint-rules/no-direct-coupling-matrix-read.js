module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban direct .couplingMatrix reads outside the coupling engine, meta-controllers, ' +
        'and pipeline plumbing. Modules that need coupling awareness should register with ' +
        'conductorIntelligence and let the hypermeta controllers manage the response -- not ' +
        'compute ad-hoc pressure formulas from raw coupling values.'
    },
    schema: []
  },
  create(context) {
    const filename = context.getFilename().replace(/\\/g, '/');

    // Legitimate paths: coupling engine, profiler, meta-controllers, diagnostics, pipeline plumbing
    const EXEMPT_PATHS = [
      'src/conductor/signal/balancing/',
      'src/conductor/signal/profiling/',
      'src/conductor/signal/meta/',
      'src/conductor/signal/output/',
      'src/play/main.js',
      'src/play/crossLayerBeatRecord.js',
      'src/play/processBeat.js',
      'src/writer/traceDrain.js'
    ];

    // Legacy violations tracked for removal -- do NOT add new entries
    const LEGACY_EXEMPT = [
      'src/rhythm/phaseLockedRhythmGenerator.js',
      'src/conductor/conductorDampening.js',
      'src/conductor/dynamics/densityWaveAnalyzer.js',
      'src/conductor/dynamics/velocityShapeAnalyzer.js',
      'src/conductor/dynamismEngine.js',
      'src/conductor/globalConductor.js',
      'src/conductor/signal/narrative/narrativeTrajectory.js',
      'src/conductor/texture/phrasing/repetitionFatigueMonitor.js',
      'src/crossLayer/structure/entropy/entropyRegulator.js',
      // R71 E1: adaptiveTrustScores coupling brake removed
      'src/crossLayer/structure/trust/adaptiveTrustScoresHelpers.js'
    ];

    const isExempt = EXEMPT_PATHS.some(p => filename.includes(p)) ||
                     LEGACY_EXEMPT.some(p => filename.includes(p));
    if (isExempt) return {};

    const MSG =
      'Coupling matrix firewall: do not read .couplingMatrix directly. ' +
      'Let the hypermeta controllers manage coupling responses. ' +
      'If you need coupling awareness, register a bias with conductorIntelligence ' +
      'and respond to coupling via the controller chain.';

    return {
      MemberExpression(node) {
        const prop = node.property;
        if (prop && prop.type === 'Identifier' && prop.name === 'couplingMatrix') {
          context.report({ node, message: MSG });
        }
      },
      Property(node) {
        if (
          node.parent && node.parent.type === 'ObjectPattern' &&
          node.key && node.key.type === 'Identifier' &&
          node.key.name === 'couplingMatrix'
        ) {
          context.report({ node, message: MSG });
        }
      }
    };
  }
};

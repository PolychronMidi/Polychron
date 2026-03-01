// scripts/eslint-rules/no-direct-crosslayer-write-from-conductor.js
// Architectural boundary enforcement: conductor modules must not call mutating
// methods on cross-layer globals. Read-only access (get*, is*, has*, query*) is
// permitted. explainabilityBus is fully exempt (diagnostic channel per architecture).

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce that conductor modules do not write to cross-layer state. ' +
        'Only read-only method calls (get*, is*, has*, query*) are permitted. ' +
        'explainabilityBus.emit() is exempt as the designated diagnostic channel.'
    },
    schema: []
  },
  create(context) {
    const filename = context.getFilename().replace(/\\/g, '/');

    // Only enforce inside src/conductor/
    if (!filename.includes('src/conductor/')) return {};

    // Cross-layer globals that must not be mutated from conductor
    const CROSS_LAYER_GLOBALS = new Set([
      'crossLayerRegistry', 'crossLayerLifecycleManager', 'conductorSignalBridge',
      'negotiationEngine', 'interactionHeatMap', 'entropyRegulator', 'entropyMetrics',
      'crossLayerSilhouette', 'crossLayerClimaxEngine', 'crossLayerDynamicEnvelope',
      'sectionIntentCurves', 'beatInterleavedProcessor', 'contextualTrust',
      'adaptiveTrustScores', 'restSynchronizer', 'dynamicRoleSwap',
      'texturalMirror', 'velocityInterference', 'articulationComplement',
      'cadenceAlignment', 'convergenceHarmonicTrigger', 'harmonicIntervalGuard',
      'motifEcho', 'motifIdentityMemory', 'phaseAwareCadenceWindow',
      'pitchMemoryRecall', 'registerCollisionAvoider', 'spectralComplementarity',
      'verticalIntervalMonitor', 'convergenceDetector', 'emergentDownbeat',
      'feedbackOscillator', 'grooveTransfer', 'polyrhythmicPhasePredictor',
      'rhythmicComplementEngine', 'rhythmicPhaseLock', 'stutterContagion',
      'temporalGravity'
    ]);
    // explainabilityBus is intentionally NOT in this set (exempt diagnostic channel)

    // Read-only method prefixes — these are safe to call from conductor
    const READ_PATTERN = /^(get|is|has|query)/;
    // Additional read-only methods that do not match the prefix pattern
    const READ_EXCEPTIONS = new Set(['pitchEntropy', 'velocityVariance']);

    function isReadOnly(methodName) {
      return READ_PATTERN.test(methodName) || READ_EXCEPTIONS.has(methodName);
    }

    return {
      // Ban: crossLayerGlobal.mutatingMethod()
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression') return;
        const obj = callee.object;
        if (!obj || obj.type !== 'Identifier') return;
        if (!CROSS_LAYER_GLOBALS.has(obj.name)) return;

        const prop = callee.property;
        const methodName = (prop && prop.type === 'Identifier')
          ? prop.name
          : ((prop && prop.type === 'Literal') ? String(prop.value) : null);

        if (methodName && isReadOnly(methodName)) return;

        context.report({
          node,
          message:
            `Architectural boundary: conductor modules must not call mutating methods on ` +
            `cross-layer global ${obj.name}.${methodName || '?'}(). ` +
            `Only read-only methods (get*, is*, has*, query*) are permitted. ` +
            `Use explainabilityBus.emit() for diagnostics.`
        });
      },

      // Ban: crossLayerGlobal.prop = value
      AssignmentExpression(node) {
        const left = node.left;
        if (!left || left.type !== 'MemberExpression') return;
        const obj = left.object;
        if (!obj || obj.type !== 'Identifier') return;
        if (!CROSS_LAYER_GLOBALS.has(obj.name)) return;

        const prop = left.property;
        const propName = (prop && prop.type === 'Identifier')
          ? prop.name
          : ((prop && prop.type === 'Literal') ? String(prop.value) : '?');

        context.report({
          node,
          message:
            `Architectural boundary: conductor modules must not assign to ` +
            `cross-layer global ${obj.name}.${propName}. ` +
            `Use explainabilityBus.emit() for diagnostics.`
        });
      }
    };
  }
};

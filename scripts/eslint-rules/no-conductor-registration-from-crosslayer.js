module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow ConductorIntelligence.registerDensityBias/registerTensionBias/registerFlickerModifier in src/crossLayer/',
      recommended: false
    },
    schema: []
  },
  create(context) {
    const pathMod = require('path');
    const filename = context.getFilename();
    const normalized = filename.replace(/\\/g, '/');

    // Only enforce inside src/crossLayer/
    if (!normalized.includes('src/crossLayer/')) return {};

    const BANNED_METHODS = new Set([
      'registerDensityBias',
      'registerTensionBias',
      'registerFlickerModifier'
    ]);

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression') return;
        const obj = callee.object;
        const prop = callee.property;
        if (!obj || obj.type !== 'Identifier' || obj.name !== 'ConductorIntelligence') return;
        const methodName = (prop && prop.type === 'Identifier') ? prop.name : ((prop && prop.type === 'Literal') ? prop.value : null);
        if (methodName && BANNED_METHODS.has(methodName)) {
          context.report({
            node,
            message: `Firewall violation: cross-layer modules must not register conductor biases. ` +
              `ConductorIntelligence.${methodName}() is only allowed in src/conductor/. ` +
              `Modify playProb/stutterProb locally or emit to ExplainabilityBus instead.`
          });
        }
      }
    };
  }
};

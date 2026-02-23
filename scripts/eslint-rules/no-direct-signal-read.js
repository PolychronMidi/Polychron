module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce reading conductor signals via signalReader rather than calling ' +
        'ConductorIntelligence.getSignalSnapshot() or ExplainabilityBus.queryByType() directly.'
    },
    schema: []
  },
  create(context) {
    const pathMod = require('path');
    const filename = context.getFilename();
    const normalized = filename.replace(/\\/g, '/');

    // The two legitimate chokepoints are exempt
    if (
      normalized.includes('src/conductor/signalReader.js') ||
      normalized.includes('src/crossLayer/conductorSignalBridge.js')
    ) return {};

    const BANNED = [
      { obj: 'ConductorIntelligence', method: 'getSignalSnapshot' },
      { obj: 'ExplainabilityBus', method: 'queryByType' }
    ];

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression') return;
        const obj = callee.object;
        const prop = callee.property;
        if (!obj || obj.type !== 'Identifier') return;
        const methodName = (prop && prop.type === 'Identifier') ? prop.name : null;
        for (const banned of BANNED) {
          if (obj.name === banned.obj && methodName === banned.method) {
            context.report({
              node,
              message:
                `Signal firewall: read signals via signalReader instead of calling ` +
                `${banned.obj}.${banned.method}() directly. ` +
                `Use signalReader.snapshot(), signalReader.density(), etc.`
            });
          }
        }
      }
    };
  }
};

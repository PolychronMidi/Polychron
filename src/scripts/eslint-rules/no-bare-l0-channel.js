// Ban bare string literals as the first argument to L0 methods.
// Channel names must use L0_CHANNELS.xxx constants to prevent typo-invisible mismatches.

const L0_METHODS = new Set(['post', 'getLast', 'query', 'count', 'getBounds', 'findClosest', 'reset']);

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require L0_CHANNELS constants instead of bare string literals in L0 method calls.'
    },
    schema: []
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression') return;
        const obj = callee.object;
        const prop = callee.property;
        if (!obj || obj.type !== 'Identifier' || obj.name !== 'L0') return;
        const methodName = prop && prop.type === 'Identifier' ? prop.name : null;
        if (!methodName || !L0_METHODS.has(methodName)) return;
        const firstArg = node.arguments[0];
        if (!firstArg) return;
        if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
          context.report({
            node: firstArg,
            message:
              `Use L0_CHANNELS constant instead of bare string '${firstArg.value}' in L0.${methodName}(). ` +
              'Bare channel name strings are typo-invisible.'
          });
        }
        if (firstArg.type === 'TemplateLiteral') {
          context.report({
            node: firstArg,
            message:
              `Use L0_CHANNELS constant instead of template literal in L0.${methodName}(). ` +
              'Bare channel name strings are typo-invisible.'
          });
        }
      }
    };
  }
};

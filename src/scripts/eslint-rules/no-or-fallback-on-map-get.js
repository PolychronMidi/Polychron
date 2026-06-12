// Replacement: `??`. Counter pattern `(counters[k]||0)+1` is not flagged.

'use strict';

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Map.get() with `||` literal fallback collapses legit 0/false values; use `??`',
      recommended: false,
    },
    schema: [],
    fixable: 'code',
  },
  create(context) {
    function isMapGetCall(node) {
      if (!node || node.type !== 'CallExpression') return false;
      const callee = node.callee;
      if (!callee || callee.type !== 'MemberExpression') return false;
      if (!callee.property || callee.property.name !== 'get') return false;
      return true;
    }

    return {
      LogicalExpression(node) {
        if (node.operator !== '||') return;
        if (!isMapGetCall(node.left)) return;
        const right = node.right;
        if (!right) return;
        const literalShapes = ['Literal', 'ArrayExpression', 'ObjectExpression'];
        if (!literalShapes.includes(right.type)) return;
        context.report({
          node,
          message: 'Map.get() with `||` fallback collapses legitimate 0/\'\'/false values. Use `??` (nullish coalescing) so only missing keys fall back.',
          fix(fixer) {
            // Replace the `||` operator with `??`. Source range search
            // for the operator token between left and right.
            const source = context.getSourceCode();
            const opToken = source.getTokenAfter(node.left,
              (t) => t.type === 'Punctuator' && t.value === '||');
            if (!opToken) return null;
            return fixer.replaceText(opToken, '??');
          },
        });
      },
    };
  },
};

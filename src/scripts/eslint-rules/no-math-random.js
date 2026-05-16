module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow Math.random; use project RNG helpers rf/ri instead', recommended: false },
    schema: []
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression') return;
        const obj = callee.object; const prop = callee.property;
        if (obj && obj.type === 'Identifier' && obj.name === 'Math' && ((prop && prop.type === 'Identifier' && prop.name === 'random') || (prop && prop.type === 'Literal' && prop.value === 'random'))) {
          context.report({ node, message: 'Use project RNG helpers rf/ri instead of Math.random()' });
        }
      }
    };
  }
};

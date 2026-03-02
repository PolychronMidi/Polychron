// scripts/eslint-rules/prefer-validator.js
// Encourage use of validator methods (V.requireType, V.requireFinite,
// V.assertArray, V.assertNonEmptyString) over ad-hoc typeof / isFinite /
// isArray guards in modules that already have a validator instance.

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer validator methods over ad-hoc typeof / Number.isFinite / Array.isArray guards ' +
        'in files that call validator.create().'
    },
    schema: []
  },
  create(context) {
    // Only flag files that have a validator instance (contain validator.create())
    const src = context.getSourceCode().getText();
    if (!src.includes('validator.create(')) return {};

    return {
      // typeof x !== 'type' or typeof x === 'type'
      BinaryExpression(node) {
        if (node.operator !== '!==' && node.operator !== '===') return;
        const { left, right } = node;
        const hasTypeof =
          (left.type === 'UnaryExpression' && left.operator === 'typeof') ||
          (right.type === 'UnaryExpression' && right.operator === 'typeof');
        if (!hasTypeof) return;

        context.report({
          node,
          message:
            'Prefer validator methods (V.requireType, V.assertNonEmptyString) over typeof checks.'
        });
      },

      // !Number.isFinite(x) or !Array.isArray(x)
      UnaryExpression(node) {
        if (node.operator !== '!') return;
        const arg = node.argument;
        if (!arg || arg.type !== 'CallExpression') return;
        const callee = arg.callee;
        if (!callee || callee.type !== 'MemberExpression') return;

        const obj = callee.object;
        const prop = callee.property;
        if (!obj || !prop || obj.type !== 'Identifier') return;

        if (obj.name === 'Number' && prop.name === 'isFinite') {
          context.report({
            node,
            message: 'Prefer V.requireFinite() over !Number.isFinite() guard.'
          });
        }
        if (obj.name === 'Array' && prop.name === 'isArray') {
          context.report({
            node,
            message: 'Prefer V.assertArray() over !Array.isArray() guard.'
          });
        }
      }
    };
  }
};

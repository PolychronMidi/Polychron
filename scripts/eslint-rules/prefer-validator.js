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

    function isThrowingGuard(node) {
      let parent = node.parent;
      while (parent) {
        if (parent.type === 'IfStatement') {
          // Check if consequent or alternate has a throw
          const hasThrow = (stmt) => {
            if (!stmt) return false;
            if (stmt.type === 'ThrowStatement') return true;
            if (stmt.type === 'BlockStatement') {
              return stmt.body.some(s => s.type === 'ThrowStatement');
            }
            return false;
          };
          if (hasThrow(parent.consequent) || hasThrow(parent.alternate)) {
            return true;
          }
          return false;
        }
        parent = parent.parent;
      }
      return false;
    }

    return {
      // typeof x !== 'type' (guards, not conditionals)
      BinaryExpression(node) {
        if (node.operator !== '!==') return;
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
          // Only flag if it's a throwing guard
          if (isThrowingGuard(node)) {
            context.report({
              node,
              message: 'Prefer V.requireFinite() over !Number.isFinite() guard.'
            });
          }
        }
        if (obj.name === 'Array' && prop.name === 'isArray') {
          // Only flag if it's a throwing guard
          if (isThrowingGuard(node)) {
            context.report({
              node,
              message: 'Prefer V.assertArray() over !Array.isArray() guard.'
            });
          }
        }
      }
    };
  }
};

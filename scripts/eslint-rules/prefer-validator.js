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

    function isInsideSafePreBoot(node) {
      let parent = node.parent;
      while (parent) {
        // safePreBoot.call(() => ...) wraps boot-safety checks centrally
        if (parent.type === 'CallExpression' &&
            parent.callee && parent.callee.type === 'MemberExpression' &&
            parent.callee.object && parent.callee.object.name === 'safePreBoot') {
          return true;
        }
        parent = parent.parent;
      }
      return false;
    }

    return {
      // typeof x !== 'type' or typeof x === 'type' (guards and conditionals)
      BinaryExpression(node) {
        if (node.operator !== '!==' && node.operator !== '===') return;
        const { left, right } = node;
        const hasTypeof =
          (left.type === 'UnaryExpression' && left.operator === 'typeof') ||
          (right.type === 'UnaryExpression' && right.operator === 'typeof');
        if (!hasTypeof) return;
        if (isInsideSafePreBoot(node)) return;

        // Extract the type string being compared
        const typeStr = (right.type === 'Literal' && typeof right.value === 'string')
          ? right.value
          : (left.type === 'Literal' && typeof left.value === 'string') ? left.value : null;

        const hint = typeStr === 'number' ? 'V.requireFinite() or V.optionalFinite()'
          : typeStr === 'string' ? 'V.assertNonEmptyString() or V.optionalType()'
          : typeStr === 'function' ? 'V.requireType(x, \'function\', name)'
          : typeStr === 'object' ? 'V.assertObject() or V.assertPlainObject()'
          : 'validator methods';

        context.report({
          node,
          message: `Prefer ${hint} over typeof checks.`
        });
      },

      // Number.isFinite(x) or !Number.isFinite(x) or Array.isArray(x) or !Array.isArray(x)
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression') return;
        const obj = callee.object;
        const prop = callee.property;
        if (!obj || !prop || obj.type !== 'Identifier') return;
        if (isInsideSafePreBoot(node)) return;

        if (obj.name === 'Number' && prop.name === 'isFinite') {
          context.report({
            node,
            message: 'Prefer V.requireFinite() or V.optionalFinite() over Number.isFinite().'
          });
        }
        if (obj.name === 'Array' && prop.name === 'isArray') {
          context.report({
            node,
            message: 'Prefer V.assertArray() over Array.isArray().'
          });
        }
      }
    };
  }
};

// ESLint: bans `_<config>.foo || <literal>` silent fallback on config reads
// (rewrites legit 0/''/false). Trigger: `||` or `??` whose LHS is a member
// expression on _cc/_atsc/_cimc/etc. + RHS is Literal/Array/Object.
// Replacement: V.optionalFinite/optionalType/optionalString. Exempt when no
// `validator` import.

'use strict';

const CONFIG_VAR_PATTERN = /^_(?:cc|atsc|cimc|pgcc|atsc|ccc|cfg|mpc|ac|tc)[A-Z0-9_]*$|^_(?:cc|atsc|cimc|pgcc|cfg)$/;
// Known project config-section variable prefixes. Extend here as new
// controller sections adopt the _<short>C / _<short> naming convention.

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Config reads must use validator.optional* (not `|| default` silent fallback)',
      recommended: false,
    },
    schema: [],
  },
  create(context) {
    const source = context.getSourceCode().getText();
    // Fast bail-out: rule is only meaningful when validator is available.
    // If the file doesn't reference validator at all, skip.
    if (!/\bvalidator\.create\b|\bV\.optional/.test(source)) return {};

    function isConfigVarRead(node) {
      if (!node || node.type !== 'MemberExpression') return false;
      const obj = node.object;
      if (!obj) return false;
      if (obj.type === 'Identifier' && CONFIG_VAR_PATTERN.test(obj.name)) return true;
      // CallExpression to .getSection( as a config read site.
      if (obj.type === 'CallExpression'
          && obj.callee && obj.callee.type === 'MemberExpression'
          && obj.callee.property && obj.callee.property.name === 'getSection') {
        return true;
      }
      return false;
    }

    return {
      LogicalExpression(node) {
        if (node.operator !== '||' && node.operator !== '??') return;
        if (!isConfigVarRead(node.left)) return;
        const right = node.right;
        if (!right) return;
        const isLiteral = right.type === 'Literal'
          || right.type === 'ArrayExpression'
          || right.type === 'ObjectExpression';
        if (!isLiteral) return;
        // Skip if the right-hand side is `0` or `[]` or `{}` used as
        context.report({
          node,
          message: 'Config read with `||`/`??` fallback -- use `V.optionalFinite(val, default)` / `V.optionalType(val, kind, default)` so wrong types fail fast instead of silently coercing.',
        });
      },
    };
  },
};

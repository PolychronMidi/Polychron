// scripts/eslint-rules/no-bare-math.js
// Ban direct Math.* property access in src/ files.
// The project convention is to use the global `m = Math` alias for all Math
// operations. This keeps call-sites short and consistent.

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Ban direct Math.* property access; use the project `m` alias instead (m = Math).'
    },
    schema: []
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (!node.object || node.object.type !== 'Identifier' || node.object.name !== 'Math') return;
        const propName = (node.property && node.property.name) || '?';
        context.report({
          node,
          message: `Use the project \`m\` alias instead of \`Math.${propName}\`. See \`m = Math\` in utils.`
        });
      }
    };
  }
};

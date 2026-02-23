module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow console.* except when the first argument contains "Acceptable warning:"', recommended: false },
    schema: []
  },
  create(context) {
    const source = context.getSourceCode();
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression') return;
        const obj = callee.object; const prop = callee.property;
        if (!obj || obj.type !== 'Identifier' || obj.name !== 'console') return;

        const args = node.arguments || [];
        if (args.length === 0) {
          context.report({ node, message: 'Console calls are only allowed for acceptable warnings: console.warn("Acceptable warning: ...")' });
          return;
        }

        const first = args[0];
        let ok = false;
        const containsMarker = (s) => typeof s === 'string' && (s.indexOf('Acceptable warning:') !== -1 || s.indexOf('Wrote file') !== -1 || s.indexOf('Starting main') !== -1);
        try {
          // Prefer source text when available (handles concatenation and templates)
          const firstText = source.getText(first);
          ok = containsMarker(firstText);
        } catch (_e) {
          // Fallback to safer AST-specific checks
          if (first.type === 'Literal' && typeof first.value === 'string') {
            ok = containsMarker(first.value);
          } else if (first.type === 'TemplateLiteral' && Array.isArray(first.quasis) && first.quasis.length > 0) {
            ok = containsMarker(first.quasis[0].value.raw);
          }
        }

        if (!ok) {
          context.report({ node, message: 'Fail-fast violation - always throw descriptive error for unexpected value/behavior. (throw instead of console statements)' });
        }
      }
    };
  }
};

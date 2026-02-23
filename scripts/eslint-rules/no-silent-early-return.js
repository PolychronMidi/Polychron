module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow early returns without explicit handling (prefer throwing an Error or explicit handling)',
      recommended: false
    },
    schema: [{
      type: 'object',
      properties: {
        allowInTests: { type: 'boolean' }
      },
      additionalProperties: false
    }]
  },
  create(context) {
    return {
      ReturnStatement(node) {
        // Only target bare returns (no explicit argument). If an explicit value is returned (including null), consider that intentional.
        if (node.argument) return;

        const parent = node.parent;
        if (!parent || !Array.isArray(parent.body)) return;
        const idx = parent.body.indexOf(node);
        if (idx === -1) return;
        const prevIndexMax = Math.max(0, idx - 3);
        let allowed = false;
        for (let i = idx - 1; i >= prevIndexMax; i--) {
          const prev = parent.body[i];
          if (!prev) continue;
          if (prev.type === 'ExpressionStatement' && prev.expression && prev.expression.type === 'CallExpression') {
            // If previous statement is any call (console or otherwise), treat as explicit action and allow early return
            allowed = true; break;
          }
          if (prev.type === 'ThrowStatement') { allowed = true; break; }
          // stop scanning if we hit another non-empty statement that is not a harmless assignment
          if (prev.type !== 'EmptyStatement' && prev.type !== 'ExpressionStatement') break;
        }

        // Fallback: if we couldn't find an immediate call before the return, scan the enclosing function body for any prior console call
        if (!allowed) {
          const source = context.getSourceCode();
          let fn = node.parent;
          while (fn && fn.type !== 'Program' && fn.type !== 'FunctionDeclaration' && fn.type !== 'FunctionExpression' && fn.type !== 'ArrowFunctionExpression' && fn.type !== 'MethodDefinition') fn = fn.parent;
          if (fn && fn.body && Array.isArray(fn.body.body)) {
            for (const stmt of fn.body.body) {
              if (!stmt.range || !node.range) continue;
              if (stmt.range[1] >= node.range[0]) break; // only consider prior statements
              const txt = source.getText(stmt);
              if (txt.includes('console.') || txt.includes('.warn(') || txt.includes('.error(') || txt.includes('.log(') || txt.includes('throw ')) { allowed = true; break; }
            }
          }
        }

        if (allowed) return;

        context.report({ node, message: 'Silent early return detected. Add explicit handling or throw an Error before returning.' });
      }
    };
  }
};

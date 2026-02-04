module.exports = {
  rules: {
    'no-silent-early-return': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow early returns without a preceding console log or explicit handling',
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

            context.report({ node, message: 'Silent early return detected. Add logging (e.g., console.warn) or explicit handling before returning.' });
          }
        };
      }
    },
    'no-requires-outside-index': {
      meta: {
        type: 'suggestion',
        docs: { description: 'Disallow require() calls outside of index.js files; allow a single index require in main.js', recommended: false },
        schema: []
      },
      create(context) {
        const path = require('path');
        const filename = context.getFilename();
        const basename = path.basename(filename || '');
        let mainRequireCount = 0;
        const mainRequireNodes = [];

        function isIndexishArg(arg) {
          if (!arg || arg.type !== 'Literal' || typeof arg.value !== 'string') return false;
          const v = String(arg.value);
          const last = v.split('/').pop();
          if (/^index(\.js)?$/.test(last)) return true;
          // Allow directory requires (e.g., './composers') which resolve to index.js
          if (path.extname(v) === '') return true;
          return false;
        }

        return {
          CallExpression(node) {
            if (!node.callee || node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;

            // Allow require() of packages (non-relative); only enforce rule for local/relative requires
            const arg = node.arguments && node.arguments[0];
            if (!arg || arg.type !== 'Literal' || typeof arg.value !== 'string') return;
            const reqStr = String(arg.value);
            if (!reqStr.startsWith('.')) return; // package require - always allowed

            // Allow require in index.js files
            if (basename === 'index.js') return;

            if (basename === 'main.js') {
              mainRequireCount++;
              mainRequireNodes.push(node);
              // allow only index-ish requires in main.js
              if (!isIndexishArg(arg)) {
                context.report({ node, message: 'main.js may only require index modules (e.g., ./composers or ./composers/index.js)' });
              }
              return;
            }

            // Otherwise disallow relative require()
            context.report({ node, message: 'require() calls are only allowed in index.js files and a single index require in main.js (for local requires)' });
          },

          'Program:exit'() {
            if (basename === 'main.js' && mainRequireCount > 1) {
              for (const n of mainRequireNodes) {
                context.report({ node: n, message: 'main.js may contain only a single require to an index module' });
              }
            }
          }
        };
      }
    }
  }
};

module.exports = {
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
};

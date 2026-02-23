module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce that the string passed to Validator.create() exactly matches the current file\'s basename',
      recommended: false
    },
    schema: []
  },
  create(context) {
    const pathMod = require('path');
    const filename = context.getFilename();
    const basename = pathMod.basename(filename || '', '.js');

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression') return;
        const obj = callee.object;
        const prop = callee.property;

        if (!obj || obj.type !== 'Identifier' || obj.name !== 'Validator') return;
        const methodName = (prop && prop.type === 'Identifier') ? prop.name : ((prop && prop.type === 'Literal') ? prop.value : null);

        if (methodName === 'create') {
          const args = node.arguments;
          if (args.length === 0) return;

          const firstArg = args[0];
          if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
            if (firstArg.value !== basename) {
              context.report({
                node: firstArg,
                message: `Validator.create() argument must match the filename. Expected '${basename}', got '${firstArg.value}'.`
              });
            }
          }
        }
      }
    };
  }
};

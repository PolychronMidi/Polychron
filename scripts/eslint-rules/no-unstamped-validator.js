module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow direct validator.method() calls — use a stamped V = validator.create() instance instead',
      recommended: false
    },
    schema: []
  },
  create(context) {
    const pathMod = require('path');
    const filename = context.getFilename();
    const basename = pathMod.basename(filename || '');

    // Exempt: validator.js is the implementation itself
    if (basename === 'validator.js') return {};

    const VALIDATOR_METHODS = new Set([
      'assertObject', 'assertPlainObject', 'assertBoolean', 'assertNonEmptyString',
      'assertFinite', 'assertRange', 'assertIntegerRange', 'assertArray',
      'assertArrayLength', 'assertKeysPresent', 'assertAllowedKeys', 'assertInSet',
      'requireDefined', 'requireFinite', 'optionalFinite', 'requireType',
      'requireEnum', 'getEventsOrThrow'
    ]);

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression') return;
        const obj = callee.object;
        const prop = callee.property;
        if (!obj || obj.type !== 'Identifier' || obj.name !== 'validator') return;
        const methodName = (prop && prop.type === 'Identifier') ? prop.name : ((prop && prop.type === 'Literal') ? prop.value : null);
        if (!methodName || methodName === 'create') return; // validator.create() is fine
        if (VALIDATOR_METHODS.has(methodName)) {
          context.report({
            node,
            message: `Direct validator.${methodName}() call — use a stamped instance instead: const V = validator.create('ModuleName'); V.${methodName}(...)`
          });
        }
      }
    };
  }
};

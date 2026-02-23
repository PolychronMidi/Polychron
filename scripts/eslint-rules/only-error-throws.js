module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow throwing non-Error literals; prefer throw new Error(...) or rethrow error variables', recommended: false },
    schema: []
  },
  create(context) {
    return {
      ThrowStatement(node) {
        const arg = node.argument;
        if (!arg) return; // nothing to check

        // Disallow throwing literals and template literals directly
        if (arg.type === 'Literal' || arg.type === 'TemplateLiteral') {
          context.report({ node: arg, message: 'Throwing literals is forbidden. Throw an Error object instead (e.g., throw new Error("message")).' });
          return;
        }

        // Allow re-throwing identifiers or member expressions (caught errors)
        if (arg.type === 'Identifier' || arg.type === 'MemberExpression') {
          return;
        }

        // Allow calling/constructing Error subclasses (callee name ending in "Error"), otherwise report
        if (arg.type === 'NewExpression' || arg.type === 'CallExpression') {
          const callee = arg.callee;
          let name = null;
          if (callee && callee.type === 'Identifier') name = callee.name;
          else if (callee && callee.type === 'MemberExpression' && callee.property && callee.property.type === 'Identifier') name = callee.property.name;

          if (typeof name !== 'string' || !name.match(/Error$/)) {
            context.report({ node: arg, message: 'Throwing non-Error values is disallowed. Use Error instances (e.g., throw new Error(...)) or rethrow existing errors.' });
            return;
          }

          return;
        }

        // Any other throw forms are disallowed
        context.report({ node: arg, message: 'Only Error objects or existing error variables may be thrown.' });
      }
    };
  }
};

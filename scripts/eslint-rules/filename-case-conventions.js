module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce filename case conventions and ban PascalCase functions',
      recommended: false
    },
    schema: []
  },
  create(context) {
    const pathMod = require('path');
    const filename = context.getFilename();
    const basename = pathMod.basename(filename || '', '.js');
    const isPascalCaseFilename = /^[A-Z]/.test(basename);

    let hasMatchingClass = false;

    return {
      ClassDeclaration(node) {
        if (node.id && node.id.name === basename) {
          hasMatchingClass = true;
        }
      },
      'Program:exit'(node) {
        if (isPascalCaseFilename && !hasMatchingClass) {
          context.report({
            node: node,
            message: `Filename '${basename}' starts with a capital letter but does not contain a class named '${basename}'.`
          });
        }
      },
      FunctionDeclaration(node) {
        if (node.id && /^[A-Z]/.test(node.id.name)) {
          context.report({
            node: node.id,
            message: `Function '${node.id.name}' starts with a capital letter. Functions must use camelCase.`
          });
        }
      },
      FunctionExpression(node) {
        if (node.id && /^[A-Z]/.test(node.id.name)) {
          context.report({
            node: node.id,
            message: `Function '${node.id.name}' starts with a capital letter. Functions must use camelCase.`
          });
        }
      }
    };
  }
};

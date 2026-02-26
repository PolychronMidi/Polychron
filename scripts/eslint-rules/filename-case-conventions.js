module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce PascalCase for classes only; camelCase for functions and non-class globals',
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

    // PascalCase = starts with uppercase followed by lowercase (excludes single-letter
    // identifiers like V and SCREAMING_SNAKE_CASE constants like MAX_COUNT)
    const isPascalCase = (name) => /^[A-Z][a-z]/.test(name);

    return {
      ClassDeclaration(node) {
        if (node.id && node.id.name === basename) {
          hasMatchingClass = true;
        }
        if (node.id && /^[a-z]/.test(node.id.name)) {
          context.report({
            node: node.id,
            message: `Class '${node.id.name}' starts with a lowercase letter. Classes must use PascalCase.`
          });
        }
      },
      AssignmentExpression(node) {
        if (node.left.type === 'Identifier' && node.left.name === basename &&
            node.right.type === 'ClassExpression' &&
            node.right.id && node.right.id.name === basename) {
          hasMatchingClass = true;
        }
        if (node.left.type === 'Identifier' && isPascalCase(node.left.name) &&
            node.right.type !== 'ClassExpression') {
          context.report({
            node: node.left,
            message: `'${node.left.name}' uses PascalCase but is not a class. Only classes may use PascalCase.`
          });
        }
      },
      VariableDeclarator(node) {
        if (node.id.type === 'Identifier' && node.id.name === basename &&
            node.init && node.init.type === 'ClassExpression' &&
            node.init.id && node.init.id.name === basename) {
          hasMatchingClass = true;
        }
        if (node.id.type === 'Identifier' && isPascalCase(node.id.name) &&
            (!node.init || node.init.type !== 'ClassExpression')) {
          context.report({
            node: node.id,
            message: `'${node.id.name}' uses PascalCase but is not a class. Only classes may use PascalCase.`
          });
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

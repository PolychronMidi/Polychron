// scripts/eslint-rules/no-empty-catch.js
// Ban catch blocks that silently swallow errors. Catch blocks must either:
// - Rethrow (throw)
// - Log with console.error/console.warn
// - Call an error handler function
// - Assign to a fallback variable (explicit recovery)
//
// Allowed exemption: safePreBoot.call() wraps the try/catch pattern centrally
// and is the project's intended way to handle pre-boot dependencies.
// Duck-type validation catches are allowed when catch body contains a
// validator call or constructor invocation (explicit fallback logic).

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban empty or comment-only catch blocks. Catch must rethrow, log, ' +
        'or perform explicit recovery. Use safePreBoot.call() for boot-safety.'
    },
    schema: []
  },
  create(context) {
    const filename = context.getFilename();
    // safePreBoot.js is the ONE canonical location for boot-safety catches
    const isSafePreBoot = filename.endsWith('safePreBoot.js');

    return {
      CatchClause(node) {
        if (isSafePreBoot) return;
        const body = node.body;
        if (!body || body.type !== 'BlockStatement') return;

        // Empty catch block (no statements at all)
        if (body.body.length === 0) {
          context.report({
            node,
            message:
              'Empty catch block silently swallows errors. ' +
              'Rethrow, log with console.error, or use safePreBoot.call().'
          });
          return;
        }

        // Check if ALL statements are void expressions (e.g., `void _err;`)
        const allVoid = body.body.every(
          stmt =>
            stmt.type === 'ExpressionStatement' &&
            stmt.expression.type === 'UnaryExpression' &&
            stmt.expression.operator === 'void'
        );
        if (allVoid) {
          context.report({
            node,
            message:
              'Catch block with only `void` silently swallows errors. ' +
              'Rethrow, log with console.error, or use safePreBoot.call().'
          });
          return;
        }

        // Check if body contains ONLY comment-style code (no real statements)
        // A block with statements means the catch does something.
        // But we need to check if those statements are meaningful.
        const hasRealCode = body.body.some(stmt => {
          // throw statement -- rethrowing
          if (stmt.type === 'ThrowStatement') return true;
          // return statement -- explicit early return with value
          if (stmt.type === 'ReturnStatement') return true;
          // assignment -- explicit recovery
          if (
            stmt.type === 'ExpressionStatement' &&
            stmt.expression.type === 'AssignmentExpression'
          ) return true;
          // function call -- error handler, console.error, etc.
          if (
            stmt.type === 'ExpressionStatement' &&
            stmt.expression.type === 'CallExpression'
          ) return true;
          // variable declaration -- fallback computation
          if (stmt.type === 'VariableDeclaration') return true;
          // if/switch -- conditional recovery
          if (stmt.type === 'IfStatement' || stmt.type === 'SwitchStatement') return true;
          return false;
        });

        if (!hasRealCode) {
          context.report({
            node,
            message:
              'Catch block has no recovery logic (only comments or void). ' +
              'Rethrow, log with console.error, or use safePreBoot.call().'
          });
        }
      }
    };
  }
};

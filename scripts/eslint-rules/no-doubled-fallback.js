// Ban doubled fallbacks: `expr || N` where `expr` is already a call that
// provides its own fallback (V.optionalFinite with 2 args, safePreBoot.call
// with 2 args) or a ternary that already has a default.
//
// Doubled fallbacks are either dead code (the outer fallback can never fire)
// or, worse, silently rewrite legitimate 0/false/empty values to the outer
// fallback. This class of bug was behind the regimeClassifierClassification
// tension-gating incident where `safePreBoot.call(..., 0.5) || 0.5` converted
// every real 0 tension reading to 0.5, skewing regime transition logic.
//
// Fix guidance reported in the message — use the inner value directly, or
// replace `||` with `??` if the intent was specifically to catch undefined.

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban doubled fallback patterns — they either hide bugs or coerce legitimate falsy values.'
    },
    schema: []
  },
  create(context) {
    function isValidatorCallWithFallback(node) {
      // V.optionalFinite(x, fallback) — two arguments
      if (
        node &&
        node.type === 'CallExpression' &&
        node.callee &&
        node.callee.type === 'MemberExpression' &&
        node.callee.object &&
        node.callee.object.type === 'Identifier' &&
        node.callee.object.name === 'V' &&
        node.callee.property &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'optionalFinite' &&
        node.arguments.length >= 2
      ) {
        return 'V.optionalFinite';
      }
      return null;
    }

    function isSafePreBootWithFallback(node) {
      // safePreBoot.call(fn, fallback) — two arguments
      if (
        node &&
        node.type === 'CallExpression' &&
        node.callee &&
        node.callee.type === 'MemberExpression' &&
        node.callee.object &&
        node.callee.object.type === 'Identifier' &&
        node.callee.object.name === 'safePreBoot' &&
        node.callee.property &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'call' &&
        node.arguments.length >= 2
      ) {
        return 'safePreBoot.call';
      }
      return null;
    }

    function isTernaryWithDefault(node) {
      // cond ? value : fallback — both alternates are defined
      if (
        node &&
        node.type === 'ConditionalExpression' &&
        node.consequent &&
        node.alternate
      ) {
        return 'ternary';
      }
      return null;
    }

    function leftSideSource(left) {
      // Unwrap a ParenthesizedExpression if ESLint surfaces one (older versions).
      let inner = left;
      if (inner && inner.type === 'ParenthesizedExpression' && inner.expression) {
        inner = inner.expression;
      }
      return (
        isValidatorCallWithFallback(inner) ||
        isSafePreBootWithFallback(inner) ||
        isTernaryWithDefault(inner)
      );
    }

    return {
      LogicalExpression(node) {
        if (node.operator !== '||') return;
        const srcName = leftSideSource(node.left);
        if (!srcName) return;
        // Right side must be a literal (number/string/boolean) — otherwise the
        // outer `||` might be intentional routing logic.
        const right = node.right;
        const rightIsLiteral =
          right &&
          (right.type === 'Literal' ||
            // Negative literals surface as UnaryExpression in ESTree
            (right.type === 'UnaryExpression' &&
              right.operator === '-' &&
              right.argument &&
              right.argument.type === 'Literal'));
        if (!rightIsLiteral) return;
        context.report({
          node,
          message:
            `Doubled fallback: \`${srcName}(...)\` already provides a default, ` +
            'so the outer `|| <literal>` is either dead code or silently coerces ' +
            'legitimate 0 / false / empty values. Drop the outer fallback, or use ' +
            '`??` if you specifically need to catch undefined/null.'
        });
      }
    };
  }
};

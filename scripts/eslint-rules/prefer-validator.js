// scripts/eslint-rules/prefer-validator.js
// Enforce use of validator methods over ad-hoc typeof / isFinite / isArray guards
// in modules that already have a validator instance (contain validator.create()).
//
// Catches two classes:
// 1. Negative guards: typeof x !== 'type', !Number.isFinite(x), !Array.isArray(x)
// 2. Positive ternary fallbacks: typeof x === 'number' ? x : 0
//    (the silent-fallback antipattern — use V.optionalFinite / V.optionalType instead)

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer validator methods over ad-hoc typeof / Number.isFinite / Array.isArray guards ' +
        'in files that call validator.create().'
    },
    schema: []
  },
  create(context) {
    // Only flag files that have a validator instance (contain validator.create())
    const src = context.getSourceCode().getText();
    if (!src.includes('validator.create(')) return {};

    function isInsideSafePreBoot(node) {
      let parent = node.parent;
      while (parent) {
        // safePreBoot.call(() => ...) wraps boot-safety checks centrally
        if (parent.type === 'CallExpression' &&
            parent.callee && parent.callee.type === 'MemberExpression' &&
            parent.callee.object && parent.callee.object.name === 'safePreBoot') {
          return true;
        }
        parent = parent.parent;
      }
      return false;
    }

    /**
     * Returns the type-string from a `typeof x === 'type'` or `'type' === typeof x` binary node,
     * or null if the node isn't that pattern.
     */
    function getTypeofPositiveType(node) {
      if (node.type !== 'BinaryExpression' || node.operator !== '===') return null;
      const { left, right } = node;
      if (left.type === 'UnaryExpression' && left.operator === 'typeof' &&
          right.type === 'Literal' && typeof right.value === 'string') {
        return right.value;
      }
      if (right.type === 'UnaryExpression' && right.operator === 'typeof' &&
          left.type === 'Literal' && typeof left.value === 'string') {
        return left.value;
      }
      return null;
    }

    /**
     * Returns the type-string if the node is a typeof==='type' check,
     * possibly wrapped in an &&-chain with Number.isFinite, optionalFinite,
     * or a null-guard (x && ...). Returns null otherwise.
     */
    function extractTypeofType(node) {
      // Direct: typeof x === 'type'
      const direct = getTypeofPositiveType(node);
      if (direct) return direct;
      // Compound: (typeof x === 'number' && Number.isFinite(x)) or (guard && typeof x === 'number')
      if (node.type === 'LogicalExpression' && node.operator === '&&') {
        const leftType = extractTypeofType(node.left);
        if (leftType) return leftType;
        const rightType = extractTypeofType(node.right);
        if (rightType) return rightType;
      }
      return null;
    }

    return {
      // === Negative guards (were already caught, kept for completeness) ===
      BinaryExpression(node) {
        if (node.operator !== '!==') return;
        const { left, right } = node;
        const hasTypeof =
          (left.type === 'UnaryExpression' && left.operator === 'typeof') ||
          (right.type === 'UnaryExpression' && right.operator === 'typeof');
        if (!hasTypeof) return;
        if (isInsideSafePreBoot(node)) return;

        const typeStr = (right.type === 'Literal' && typeof right.value === 'string')
          ? right.value
          : (left.type === 'Literal' && typeof left.value === 'string') ? left.value : null;

        const hint = typeStr === 'number' ? 'V.requireFinite() or V.optionalFinite()'
          : typeStr === 'string' ? 'V.assertNonEmptyString() or V.optionalString()'
          : typeStr === 'function' ? 'V.requireType(x, \'function\', name)'
          : typeStr === 'object' ? 'V.assertObject() or V.assertPlainObject()'
          : 'validator methods';

        context.report({ node, message: `Prefer ${hint} over typeof checks.` });
      },

      // === Positive ternary fallbacks: typeof x === 'type' ? x : fallback ===
      // These are the silent-fallback antipatterns: use V.optionalFinite / V.optionalType.
      // Only flag when the ternary test IS the typeof check (possibly in &&-chain) AND
      // the alternate branch is a simple fallback (literal or identifier), not another typeof
      // discriminant check. This avoids flagging legitimate union-type discriminant patterns.
      ConditionalExpression(node) {
        if (isInsideSafePreBoot(node)) return;
        // Is the ternary TEST rooted in a typeof === check?
        const typeStr = extractTypeofType(node.test);
        if (!typeStr) return;

        // Skip if alternate is a nested typeof/type-narrowing ternary (discriminant pattern).
        // e.g. typeof x === 'number' ? x : (typeof x === 'string' ? x : null)
        if (node.alternate && extractTypeofType(
          node.alternate.type === 'ConditionalExpression' ? node.alternate.test : node.alternate
        )) return;

        // Only flag when the CONSEQUENT is a simple pass-through (Identifier or MemberExpression
        // chain that IS the typeof target) and ALTERNATE is a literal fallback. This avoids
        // flagging discriminant patterns where the consequent does real work (property access,
        // method call) on a different value from the typeof target.
        const consq = node.consequent;
        const alt = node.alternate;
        // If consequent does real work on the value (property access, method call, arithmetic,
        // object construction), it's a discriminant/transform, not a silent fallback — skip.
        if (consq && (
          consq.type === 'MemberExpression' ||
          consq.type === 'CallExpression' ||
          consq.type === 'NewExpression' ||
          consq.type === 'ConditionalExpression' ||
          consq.type === 'ObjectExpression' ||
          consq.type === 'ArrayExpression' ||
          consq.type === 'BinaryExpression' ||
          consq.type === 'TemplateLiteral'
        )) return;
        const altIsSimple = !alt || alt.type === 'Literal' || alt.type === 'Identifier' ||
          (alt.type === 'UnaryExpression' && alt.operator === '-' && alt.argument && alt.argument.type === 'Literal');
        const altIsTypeof = alt && (alt.type === 'BinaryExpression' || alt.type === 'LogicalExpression') &&
          extractTypeofType(alt);
        if (!altIsSimple && !altIsTypeof) return;

        const hint = typeStr === 'number'
          ? 'V.optionalFinite(value, fallback) instead of typeof/ternary fallback'
          : typeStr === 'string'
          ? 'V.optionalString(value, fallback) instead of typeof/ternary fallback'
          : typeStr === 'object'
          ? 'V.optionalType(value, \'object\', fallback) instead of typeof/ternary fallback'
          : `V.optionalType(value, '${typeStr}', fallback) instead of typeof/ternary fallback`;

        context.report({
          node,
          message: `Prefer ${hint}.`
        });
      },

      // === Negative isFinite / isArray (existing behavior) ===
      UnaryExpression(node) {
        if (node.operator !== '!') return;
        const arg = node.argument;
        if (!arg || arg.type !== 'CallExpression') return;
        const callee = arg.callee;
        if (!callee || callee.type !== 'MemberExpression') return;
        const obj = callee.object;
        const prop = callee.property;
        if (!obj || !prop || obj.type !== 'Identifier') return;
        if (isInsideSafePreBoot(node)) return;

        if (obj.name === 'Number' && prop.name === 'isFinite') {
          context.report({
            node,
            message: 'Prefer V.requireFinite() or V.optionalFinite() over !Number.isFinite().'
          });
        }
        if (obj.name === 'Array' && prop.name === 'isArray') {
          context.report({
            node,
            message: 'Prefer V.assertArray() over !Array.isArray().'
          });
        }
      }
    };
  }
};

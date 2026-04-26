// ESLint rule: no-or-fallback-on-map-get
//
// Bans `Map.prototype.get(...) || <literal>` — `||` falls back on every
// falsy value (0, '', false, NaN), but `Map.get` returns `undefined`
// only when a key is absent. A legitimate value of 0 stored in the Map
// silently rewrites to the literal default, masking real lookups.
//
// Concrete bug class: `distMap.get(profileName) || 99` in a sort
// comparator — when a profile's distance is genuinely 0 (the active
// profile), it sorts to position 99 instead of 0. Caught during a
// targeted fail-fast sweep April 2026.
//
// Trigger: LogicalExpression where
//   operator === '||'
//   left  === CallExpression with `.get(...)` callee
//   right === Literal | ArrayExpression | ObjectExpression
//
// Allowed replacement: `??` (nullish coalescing) which only falls back
// on null/undefined, preserving 0/''/false as legitimate values.
//
// Out-of-scope: bare `obj.field || x` reads — handled by
// no-or-fallback-on-config-read for config-prefixed variables, or by
// type-aware lints for typed code. This rule targets the
// Map/WeakMap/cache idiom specifically because the semantic of
// "missing key → undefined, present-but-zero key → 0" is a defining
// property of the Map interface that `||` violates by collapsing both.
//
// Counter init pattern (`counters[k] = (counters[k] || 0) + 1`) is
// NOT a Map.get and is not flagged. Use of `??` in the same shape
// (`Map.get() ?? default`) is the intended replacement and passes.

'use strict';

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Map.get() with `||` literal fallback collapses legit 0/false values; use `??`',
      recommended: false,
    },
    schema: [],
    fixable: 'code',
  },
  create(context) {
    function isMapGetCall(node) {
      if (!node || node.type !== 'CallExpression') return false;
      const callee = node.callee;
      if (!callee || callee.type !== 'MemberExpression') return false;
      if (!callee.property || callee.property.name !== 'get') return false;
      return true;
    }

    return {
      LogicalExpression(node) {
        if (node.operator !== '||') return;
        if (!isMapGetCall(node.left)) return;
        const right = node.right;
        if (!right) return;
        const literalShapes = ['Literal', 'ArrayExpression', 'ObjectExpression'];
        if (!literalShapes.includes(right.type)) return;
        context.report({
          node,
          message: 'Map.get() with `||` fallback collapses legitimate 0/\'\'/false values. Use `??` (nullish coalescing) so only missing keys fall back.',
          fix(fixer) {
            // Replace the `||` operator with `??`. Source range search
            // for the operator token between left and right.
            const source = context.getSourceCode();
            const opToken = source.getTokenAfter(node.left,
              (t) => t.type === 'Punctuator' && t.value === '||');
            if (!opToken) return null;
            return fixer.replaceText(opToken, '??');
          },
        });
      },
    };
  },
};

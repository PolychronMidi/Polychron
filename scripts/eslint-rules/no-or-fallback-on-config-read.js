// ESLint rule: no-or-fallback-on-config-read
//
// Bans silent fallbacks on reads from configuration-like objects. The
// failure mode this catches: `_cc.foo || 0.5` silently rewrites a legit
// zero to 0.5, masking bad config and producing non-deterministic behavior
// that only surfaces when someone ships `foo: 0` and wonders why it
// doesn't take effect. This is the class of bug that bypassed ESLint for
// months and only surfaced during a targeted fail-fast sweep.
//
// Trigger: LogicalExpression where
//   operator === '||' OR '??'
//   left  === MemberExpression on an identifier starting with `_` (project
//            convention for config-section variables: _cc, _atsc, _cimc,
//            _pgcc, etc.) OR on an object literal destructured from
//            `controllerConfig.getSection(...)`
//   right === Literal (number, string) OR array/object expression
//
// Allowed replacements:
//   V.optionalFinite(_cc.foo, 0.5)     — numeric, catches NaN/string
//   V.optionalType(_cc.foo, 'array', [...])   — array
//   V.optionalType(_cc.foo, 'object', {...})  — object
//   V.optionalString(_cc.foo, 'default')      — string
//
// `??` is tolerated for histogram-style counter reads (Map.get(k) ?? 0)
// via the `conductor-histogram-uses-nullish` invariant — this rule
// targets config-shape reads specifically, not arbitrary map lookups.
//
// Exempt when the file imports no `validator` module (validator unavailable).

'use strict';

const CONFIG_VAR_PATTERN = /^_(?:cc|atsc|cimc|pgcc|atsc|ccc|cfg|mpc|ac|tc)[A-Z0-9_]*$|^_(?:cc|atsc|cimc|pgcc|cfg)$/;
// Known project config-section variable prefixes. Extend here as new
// controller sections adopt the _<short>C / _<short> naming convention.

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Config reads must use validator.optional* (not `|| default` silent fallback)',
      recommended: false,
    },
    schema: [],
  },
  create(context) {
    const source = context.getSourceCode().getText();
    // Fast bail-out: rule is only meaningful when validator is available.
    // If the file doesn't reference validator at all, skip.
    if (!/\bvalidator\.create\b|\bV\.optional/.test(source)) return {};

    function isConfigVarRead(node) {
      if (!node || node.type !== 'MemberExpression') return false;
      const obj = node.object;
      if (!obj) return false;
      if (obj.type === 'Identifier' && CONFIG_VAR_PATTERN.test(obj.name)) return true;
      // `controllerConfig.getSection('...').foo || X` style — treat
      // CallExpression to .getSection( as a config read site.
      if (obj.type === 'CallExpression'
          && obj.callee && obj.callee.type === 'MemberExpression'
          && obj.callee.property && obj.callee.property.name === 'getSection') {
        return true;
      }
      return false;
    }

    return {
      LogicalExpression(node) {
        if (node.operator !== '||' && node.operator !== '??') return;
        if (!isConfigVarRead(node.left)) return;
        const right = node.right;
        if (!right) return;
        const isLiteral = right.type === 'Literal'
          || right.type === 'ArrayExpression'
          || right.type === 'ObjectExpression';
        if (!isLiteral) return;
        // Skip if the right-hand side is `0` or `[]` or `{}` used as
        // histogram-identity defaults in a counter-increment expression —
        // let the conductor-histogram-uses-nullish rule handle those.
        // Config reads with explicit literal defaults are the target.
        context.report({
          node,
          message: 'Config read with `||`/`??` fallback — use `V.optionalFinite(val, default)` / `V.optionalType(val, kind, default)` so wrong types fail fast instead of silently coercing.',
        });
      },
    };
  },
};

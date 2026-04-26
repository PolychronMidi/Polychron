'use strict';
// Regression tests for the no-or-fallback-on-map-get rule.
// Run via `node scripts/eslint-rules/no-or-fallback-on-map-get.test.js`.
const { RuleTester } = require('eslint');
const rule = require('./no-or-fallback-on-map-get');

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

tester.run('no-or-fallback-on-map-get', rule, {
  valid: [
    // Nullish coalescing — the intended replacement.
    "const x = m.get('k') ?? 99;",
    // No fallback at all.
    "const x = m.get('k');",
    // Fallback on non-Map property access (out-of-scope for this rule).
    "const x = obj.field || 5;",
    // Fallback on indexed access (counter-init pattern is allowed).
    "counters[k] = (counters[k] || 0) + 1;",
    // Fallback on .get() with a NON-literal RHS (variable / expression).
    "const x = m.get('k') || dynamicDefault();",
    "const x = m.get('k') || other.thing;",
    // Different method name (.find, .at, etc.) — only .get is matched.
    "const x = arr.find(p) || 99;",
  ],
  invalid: [
    {
      code: "const x = m.get('k') || 99;",
      output: "const x = m.get('k') ?? 99;",
      errors: [{ message: /Map\.get\(\) with `\|\|` fallback/ }],
    },
    {
      code: "const x = distMap.get(name) || 99;",
      output: "const x = distMap.get(name) ?? 99;",
      errors: 1,
    },
    {
      code: "const x = m.get('k') || [];",
      output: "const x = m.get('k') ?? [];",
      errors: 1,
    },
    {
      code: "const x = m.get('k') || {};",
      output: "const x = m.get('k') ?? {};",
      errors: 1,
    },
    {
      code: "const x = m.get('k') || '';",
      output: "const x = m.get('k') ?? '';",
      errors: 1,
    },
    // Method-chain on .get() result with || literal — the LHS of the
    // outer `||` here is a MemberExpression on a.get(x), not the
    // CallExpression itself, so this rule (intentionally) doesn't fire.
    // The behavior is documented; if we want to catch this shape later,
    // it'd be a separate rule (e.g. no-or-fallback-on-map-get-chain).
  ],
});

console.log('no-or-fallback-on-map-get: all tests passed');

import localRules from './scripts/eslint-rules/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import globalsPkg from 'globals';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadManagedGlobalsFromDts() {
  const managedPath = path.resolve(__dirname, 'src', 'types', 'globals.d.ts');
  let text;
  try {
    text = fs.readFileSync(managedPath, 'utf8');
  } catch (e) {
    throw new Error(`eslint.config.mjs: failed to read managed globals file at ${managedPath}: ${e && e.message ? e.message : e}`);
  }

  const globals = {};
  const lines = String(text).split(/\r?\n/);
  const declareVarRegex = /^\s*declare\s+var\s+([A-Za-z_$][\w$]*)\s*:/;
  for (const line of lines) {
    const match = line.match(declareVarRegex);
    if (!match) continue;
    globals[match[1]] = 'readonly';
  }

  if (Object.keys(globals).length === 0) {
    throw new Error(`eslint.config.mjs: managed globals file has no declarations: ${managedPath}`);
  }

  return globals;
}
const MANAGED_GLOBALS = loadManagedGlobalsFromDts();

const restrictedGlobalsMessage = 'Global keywords banned project-wide, use naked globals instead (Example: DONT use: globalThis.variable DO use: variable)';

export default [
  {
    // Global ignores — files completely invisible to any config block.
    // tools/HME/chat/** is VS Code extension bootstrap code (uses
    // module.exports / CommonJS patterns that the project-wide src/ naked-
    // global rules would reject). Its own tsconfig handles checking.
    // tools/HME/proxy/hme_proxy.js is deliberately LINTED via the per-file
    // config below (load-bearing proxy; a `scan is not defined` block-scope
    // leak went undetected because tools/** used to be globally ignored).
    // Other tools/ JS (activity/emit.py has no .js etc.) falls through.
    ignores: [
      'scripts/**',
      'eslint.config.mjs',
      'vitest.config.mjs',
      'tmp/**',
      'eslint-rules/**',
      'lab/**',
      'tools/**',
      'tools/HME/chat/**',
      'tools/HME/service/**',
      'tools/HME/activity/**',
      'tools/HME/warm-context-cache/**',
      'tools/**/node_modules/**',
      'tools/HME/proxy/mcp_server/**',
      'tools/HME/proxy/middleware/**',
      'tools/HME/proxy/supervisor/**',
      'tools/HME/proxy/context.js',
      'tools/HME/proxy/hme_dispatcher.js',
      'tools/HME/proxy/messages.js',
      'tools/HME/proxy/shared.js',
      'tools/HME/proxy/sse_rewriters.js',
      'tools/HME/proxy/sse_transform.js',
      'tools/HME/proxy/upstream.js',
      'tools/HME/proxy/worker_client.js'
    ]
  },
  {
    // hme_proxy.js is intentionally unlinted by the global `tools/**`
    // ignore above, but it's too load-bearing to leave un-checked — a
    // `scan is not defined` (block-scoped const referenced in outer
    // scope) went undetected and would have crashed the proxy on every
    // jurisdiction-injection call. Enable the minimum rule set that
    // would have caught that: no-undef + no-unused-vars.
    files: ['tools/HME/proxy/hme_proxy.js'],
    languageOptions: {
      sourceType: 'commonjs',
      ecmaVersion: 'latest',
      globals: { ...globalsPkg.node }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['eslint.config.mjs'],
    languageOptions: { sourceType: 'module', ecmaVersion: 'latest' }
  },
  {
    files: ['src/**/*.js', 'src/**'],
    ignores: [
      'scripts/**', 'eslint.config.mjs', 'vitest.config.mjs', 'tmp/**', 'eslint-rules/**',
      '**/*.mjs',
      'node_modules/**',
      'csv_maestro/**',
      'output/**',
      'metrics/**',
      'tmp/**',
      '__pycache__/**'
    ],
    // Ban any comment that begins with "global" (e.g., /* global ... */) to enforce
    // the project's requirement to use naked globals via side-effect requires only.
    // Also enforce stricter static rules and a project-specific rule to catch
    // silent early returns (must log or explicitly handle before returning).
    plugins: { local: localRules },
    rules: {
      'eqeqeq': 'error',
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      'no-return-await': 'error',
      'no-async-promise-executor': 'error',
      'no-duplicate-imports': 'error',
      'require-atomic-updates': 'error',
      'no-await-in-loop': 'error',
      'no-shadow': 'error',
      'no-warning-comments': ['error', { terms: ['global'], location: 'start' }],
      'consistent-return': 'error',
      'no-unsafe-optional-chaining': 'error',
      'no-implicit-coercion': ['error', { 'boolean': true, 'number': true, 'string': true, 'allow': [] }],
      'no-undef': 'error',
      'local/no-silent-early-return': ['error', { allowInTests: false }],
      'local/no-requires-outside-index': ['error'],
      'local/no-console-acceptable-warning': 'error',
      'local/no-math-random': 'error',
      'local/no-useless-expose-dependencies-comments': 'error',
      'local/only-error-throws': 'error',
      'local/no-typeof-validated-global': 'error',
      'local/no-unstamped-validator': 'error',
      'local/no-conductor-registration-from-crosslayer': 'error',
      'local/no-direct-signal-read': 'error',
      'local/validator-name-matches-filename': 'error',
      'local/case-conventions': 'error',
      'local/no-non-ascii': 'error',
      'local/no-unregistered-feedback-loop': 'error',
      'local/no-direct-conductor-state-from-crosslayer': 'error',
      'local/no-direct-crosslayer-write-from-conductor': 'error',
      'local/no-direct-buffer-push-from-crosslayer': 'error',
      'local/prefer-validator': 'error',
      'local/no-bare-math': 'error',
      'local/no-direct-coupling-matrix-read': 'error',
      'local/no-empty-catch': 'error',
      'local/no-bare-l0-channel': 'error',
      'local/no-doubled-fallback': 'error',
      'local/no-or-fallback-on-config-read': 'error',
      // Disabled by default. Bulk-converting bare-global references to
      // deps. aliases appears safe but isn't: adding a name to a manifest's
      // deps causes the registry to DEFER eager instantiation until that
      // name is bound. Many declared modules are used at file-load time
      // by their legacy IIFE-bound peers (e.g. stutterVariants is read by
      // machineGun.js's top-level register call) -- deferral breaks those
      // peers' load. Per-module manual migration is required: identify
      // which deps are safe to add (no eager-load consumers), convert
      // those, leave the rest. Re-enable as 'warn' / 'error' once the
      // sweep completes per-subsystem.
      'local/no-bare-declared-global-in-init': 'warn'
    },

  },
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globalsPkg.node,
        ...MANAGED_GLOBALS,

      }
    },
    rules: {
      // Code correctness - errors that break functionality
      'no-undef': 'error',
      'no-restricted-globals': ['error', { name: 'global', message: restrictedGlobalsMessage }, { name: 'globalThis', message: restrictedGlobalsMessage }, { name: 'GLOBAL', message: restrictedGlobalsMessage }, { name: 'GLOBALTHIS', message: restrictedGlobalsMessage }, { name: 'GLOBALS', message: restrictedGlobalsMessage }, { name: 'globals', message: restrictedGlobalsMessage }],
      // Disallow runtime code-gen and common module-export workarounds that subvert naked global policy
      'no-new-func': 'error',
      'no-restricted-syntax': [
        'error',
        // Prevent calling Function(...) to synthesize code or create globals (covers Function(...))
        { selector: "CallExpression[callee.name='Function']", message: 'Do not call the Function constructor to generate code or create globals; use naked global assignment instead.' },
        // Prevent new Function(...)
        { selector: "NewExpression[callee.name='Function']", message: 'Do not use the Function constructor; use naked global assignment instead.' },
        // Prevent top-level assignments to `this` (e.g., `this.x = ...`) which act like module-scoped exports
        { selector: "Program > ExpressionStatement > AssignmentExpression[left.type='MemberExpression'][left.object.type='ThisExpression']", message: 'Top-level assignments to `this` are banned; define naked globals instead (e.g. `x = ...`).' },
        // Ban direct module.exports and exports usage (use naked globals instead)
        { selector: "MemberExpression[object.name='module'][property.name='exports']", message: 'module.exports is banned; use naked global assignments and side-effect requires.' },
        { selector: "MemberExpression[object.name='exports']", message: 'exports.* is banned; use naked global assignments and side-effect requires.' },
        // Ban global/globalThis property access
        { selector: "MemberExpression[object.name='globalThis']", message: 'Do not use globalThis; use naked globals instead.' },
        { selector: "MemberExpression[object.name='global']", message: 'Do not use global; use naked globals instead.' },
        // Prevent noisy conditional top-level assignments to naked globals e.g. `x = typeof StutterManager.x === 'function' ? StutterManager.x.bind(stutter) : x;`
        { selector: "Program > ExpressionStatement > AssignmentExpression[left.type='Identifier'][right.type='ConditionalExpression']", message: 'Avoid conditional top-level reassignments to naked globals; bind instance methods once or provide explicit wrapper functions instead.' },
        // Ban eval-based code execution
        { selector: "CallExpression[callee.name='eval']", message: 'eval is banned; do not use string-to-code execution.' }
      ],
      'no-unreachable': 'error',  // Dead code after return/throw
      'no-constant-condition': 'error',  // Conditions always true/false (can be intentional)
      'no-redeclare': 'error',
      'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],
      'radix': ['error', 'always'],
      'default-case-last': 'error',
      'no-dupe-keys': 'error',  // Duplicate object keys
      'no-dupe-args': 'error',  // Duplicate function parameters
      'no-duplicate-case': 'error',  // Duplicate switch cases
      'no-empty': 'error',  // Empty blocks (may be intentional)
      'no-ex-assign': 'error',  // Reassigning exception variable
      'no-func-assign': 'error',  // Reassigning function declarations
      'no-invalid-regexp': 'error',  // Invalid regex patterns
      'use-isnan': 'error',  // Require isNaN() for NaN checks
      'valid-typeof': 'error',  // Enforce valid typeof comparisons
      'no-self-assign': 'error',  // Catch x = x mistakes
      'no-cond-assign': ['error', 'except-parens'],  // No assignment in conditions (catch = vs ==)
      'no-fallthrough': 'error',  // Require break in switch cases

      // Code quality
      'no-irregular-whitespace': 'error',
      'no-unexpected-multiline': 'error',
      'no-useless-escape': 'error',
      'no-trailing-spaces': 'error',
      'eol-last': ['error', 'always'],
      'no-unused-vars': 'error'
    }
  },
  {
    // Proxy-specific override — relaxes the catch-all's strict rules for
    // this one file so we can still get meaningful lint coverage
    // (no-undef catches block-scope leaks) without drowning in
    // underscore-prefixed catch-handler false-positives.
    files: ['tools/HME/proxy/hme_proxy.js'],
    languageOptions: {
      sourceType: 'commonjs',
      ecmaVersion: 'latest',
      globals: { ...globalsPkg.nodeBuiltin }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-redeclare': 'off',
      'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],
      'no-restricted-syntax': 'off'
    }
  }
];

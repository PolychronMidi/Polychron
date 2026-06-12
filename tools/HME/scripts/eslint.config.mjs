import globals from 'globals';

// Dedicated lint lane for standalone HME Node scripts. Do NOT lint these with
// the root src/proxy config: that config intentionally bans CommonJS/module
export default [{
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'commonjs',
    globals: { ...globals.node },
  },
  rules: {
    'no-undef': 'error',
    'no-unused-vars': ['error', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    }],
    'no-empty': ['error', { allowEmptyCatch: true }],
    'prefer-const': ['error', { destructuring: 'all' }],
  },
}];

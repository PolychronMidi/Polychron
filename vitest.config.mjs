export default {
  test: {
    globals: true,
    // Ensure Vitest runs to completion and does not stay in watch mode in CI/local runs
    // `run: true` makes the runner execute tests and exit.
    run: true,
    timeout: 200000,
    testTimeout: 40000,
    // Load centralized log gate during test setup so console output is controlled project-wide
    // Also load `test-setup.js` which requires `stage.js` to ensure naked globals are initialized
    setupFiles: ['./src/logGate.js', './src/test-setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'csv_maestro/',
        'test/',
        '**/*.test.js',
        'scripts/',
      ],
      statements: 50,
      branches: 40,
      functions: 50,
      lines: 50,
    },
  },
};

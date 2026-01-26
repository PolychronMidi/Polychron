export default {
  test: {
    globals: true,
    // Ensure Vitest runs to completion and does not stay in watch mode in CI/local runs
    // `run: true` makes the runner execute tests and exit.
    run: true,
    // Load centralized log gate during test setup so console output is controlled project-wide
    setupFiles: ['./src/logGate.js'],
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

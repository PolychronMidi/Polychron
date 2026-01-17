export default {
  test: {
    globals: true,
    testTimeout: 30000,
    // Reporter: minimal output - only show failures and summary
    reporters: 'default',
    // Only report failures, not passing tests
    hideSkipped: false,
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

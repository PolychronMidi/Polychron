export default {
  test: {
    globals: true,
    testTimeout: 30000,
    // Setup file to silence noisy console logs during tests
    setupFiles: ['./src/test-setup.ts'],
    // Reporter: default shows concise summary + failures
    reporters: process.env.CI ? 'default' : 'default',
    // Only report failures, not passing tests
    hideSkipped: false,
    // Exclude runtime-generated temporary test folders and node_modules tests
    exclude: ['tmp/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['test/**/*.ts'],
      exclude: [
        'node_modules/',
        'csv_maestro/',
        'scripts/',
      ],
      statements: 50,
      branches: 40,
      functions: 50,
      lines: 50,
    },
  },
};

import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: [
      'node_modules/**',
      'csv_maestro/**',
      'output/**',
      '__pycache__/**',
      'output/*.csv',
      'output/*.mid',
      'output/*.wav',
      'test/**',
      '**/*.d.ts',
      'dist/**',
      'coverage/**'
    ]
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: false
      },
      globals: {
        globalThis: 'readonly',
        require: 'readonly',
        module: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { varsIgnorePattern: '^_|^[A-Z]+$', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-undef': 'off',  // TypeScript handles this
      'no-global-assign': 'error',
      'no-restricted-syntax': 'off'
    }
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        globalThis: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'writable',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        m: 'readonly',
        beatCount: 'writable',
        beatsUntilBinauralShift: 'writable',
        subdivsPerBeat: 'writable',
        velocity: 'writable',
        activeMotif: 'writable',
        applyMotifToNotes: 'writable',
        fxManager: 'writable',
        subsubsPerSub: 'writable',
        _: 'writable'
      }
    },
    rules: {
      'no-undef': 'warn',
      'no-trailing-spaces': 'warn',
      'eol-last': 'warn',
      'no-constant-condition': 'warn'
    }
  }
];

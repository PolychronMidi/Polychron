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
      '@typescript-eslint/no-explicit-any': 'off',  // Stage 2: Accept any for now
      '@typescript-eslint/no-unused-vars': 'off',   // Many globals intentionally unused in specific files
      'no-undef': 'off',  // TypeScript handles this
      'no-restricted-syntax': [
        'error',
        {
          selector: "Program > ExpressionStatement > AssignmentExpression[left.type='MemberExpression'][left.object.type='Identifier'][left.object.name='globalThis']",
          message: 'Do not attach new properties to globalThis at module scope; use DI instead.'
        }
      ]
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
      'eol-last': 'off',  // Stage 2: Accept for now
      'no-constant-condition': 'warn'
    }
  }
];

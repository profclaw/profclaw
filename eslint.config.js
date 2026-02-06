import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'build/',
      'node_modules/',
      'ui/',
      'coverage/',
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/*.e2e.test.ts',
      'src/e2e/',
      'src/gateway/',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Relaxed for initial release — tighten incrementally
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-require-imports': 'off',
      'prefer-const': 'error',
      'no-console': 'off', // Uses custom logger but also console in many places
    },
  },
);

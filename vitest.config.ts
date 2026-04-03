import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    isolate: true,
    exclude: [
      'node_modules/**',
      'ui/**',
      'docs-local/**',
      'website/**',
      '.claude/worktrees/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.bench.test.ts',
        '**/*.config.ts',
        'scripts/**',
      ],
      all: true,
      thresholds: {
        // Target: lines 70, functions 65, branches 60, statements 70
        // Raised from 50/45/40/50 after adding 13 test suites (221 tests)
        // Raise to target once pre-existing test failures are fixed
        lines: 60,
        functions: 55,
        branches: 50,
        statements: 60,
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});

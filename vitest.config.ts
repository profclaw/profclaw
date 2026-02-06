import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.test.ts',
        '**/*.bench.test.ts',
        '**/*.config.ts',
        'scripts/**',
      ],
      all: true,
      thresholds: {
        // Launch targets - increase to 70%+ post-launch
        lines: 50,
        functions: 45,
        branches: 40,
        statements: 50,
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 180_000,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['packages/{money,seal,policy,contracts,sdk,circle}/test/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['packages/core/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
          globalSetup: ['./test/postgres.global.ts'],
        },
        resolve: {
          alias: {
            '@/': new URL('./apps/web/', import.meta.url).pathname,
            'server-only': new URL('./test/empty.ts', import.meta.url).pathname,
          },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/policy/src/**', 'packages/money/src/**', 'packages/seal/src/**'],
      exclude: ['**/types.ts'],
      thresholds: { 'packages/policy/src/**': { branches: 100, functions: 100, lines: 100, statements: 100 } },
    },
  },
});

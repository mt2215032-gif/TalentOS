import { defineConfig } from 'vitest/config';
import path from 'node:path';

const root = import.meta.dirname;

/**
 * Two projects with different needs:
 *   unit — pure logic, no I/O, fast enough to run on every save
 *   api  — exercises real handlers against a real PostgreSQL database
 *
 * The api project runs single-threaded because its tests share one database
 * and truncate between cases.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(root, './src'),
      'server-only': path.resolve(root, './tests/stubs/server-only.ts'),
    },
  },
  test: {
    projects: [
      {
        resolve: { alias: {
      '@': path.resolve(root, './src'),
      'server-only': path.resolve(root, './tests/stubs/server-only.ts'),
    } },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias: {
      '@': path.resolve(root, './src'),
      'server-only': path.resolve(root, './tests/stubs/server-only.ts'),
    } },
        test: {
          name: 'api',
          include: ['tests/api/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/api/setup.ts'],
          /*
           * Set here rather than in the setup file's beforeAll.
           *
           * `src/lib/config.ts` reads process.env at module load, and setup
           * files import the database client — so by the time a beforeAll runs,
           * the connection string is already fixed. Setting it in beforeAll
           * meant the suite fell back to the default URL and dropped the schema
           * of the *development* database. These run before any module loads.
           */
          env: {
            NODE_ENV: 'test',
            DATABASE_URL: process.env['TEST_DATABASE_URL'] ?? '',
            AI_PROVIDER: 'none',
            RATE_LIMIT_BACKEND: 'memory',
            AUTH_SECRET: 'vitest-only-secret-not-used-outside-the-test-suite',
          },
          // One database, so no parallel writers.
          fileParallelism: false,
          sequence: { concurrent: false },
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});

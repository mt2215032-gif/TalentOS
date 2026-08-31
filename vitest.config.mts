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

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    testTimeout: 70_000,
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests hit a single shared Neon dev database. One file
    // (scoring.test.ts) does an unscoped full-table rebuild of derived
    // tables mid-test, which deadlocks against any other file's concurrent
    // writes if vitest runs files in parallel. Run test files sequentially.
    fileParallelism: false,
  },
});

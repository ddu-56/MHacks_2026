import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The phone simulations and browser-agent tests are real-time (just scaled down);
    // running test files side by side starves their timers and distorts the pacing.
    fileParallelism: false,
  },
});

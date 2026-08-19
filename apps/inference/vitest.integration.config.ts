import { defineConfig } from 'vitest/config';

/**
 * Integration suite. Targets a REAL model runtime when `RUNTIME_URL` is set
 * (`RUNTIME_URL=http://127.0.0.1:8080 pnpm test:integration --run chat-completions`),
 * and the in-process fake runtime otherwise — so the same assertions cover both
 * a laptop with no model loaded and a live llama-server.
 *
 * A real 1.6–8B vision model on CPU can take 30 s+ for one plate, hence the
 * generous timeout.
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

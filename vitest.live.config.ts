import { defineConfig } from "vitest/config";

/**
 * The `live` suite against real X (plan §6): plain Node, never part of `npm test` or `npm run
 * check`, skipped unless GROKCHAT_LIVE=1. Run by the owner only: `npm run test:live`.
 */
export default defineConfig({
  test: {
    name: "live",
    environment: "node",
    include: ["tests/live/**/*.test.ts"],
    testTimeout: 120_000,
  },
});

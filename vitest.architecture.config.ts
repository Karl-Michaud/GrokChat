import { defineConfig } from "vitest/config";

/** Plain Node: the gates' own tests (dependency rules, ambient types, lint fixtures). */
export default defineConfig({
  test: {
    name: "architecture",
    environment: "node",
    include: ["tests/architecture/**/*.test.ts"],
    testTimeout: 120_000,
  },
});

import { defineConfig } from "vitest/config";

/** Plain Node: the pure layers' tests. Stryker runs this project only (plan §5, A6). */
export default defineConfig({
  test: {
    name: "unit",
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/invariants/**/*.test.ts"],
  },
});

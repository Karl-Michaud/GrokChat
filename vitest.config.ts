import { defineConfig } from "vitest/config";

/**
 * Runs every test project with one istanbul coverage report over src/. Line and branch coverage
 * are separate thresholds, each at 90% (Agents/CLAUDE.md §7.1; plan §5).
 */
export default defineConfig({
  test: {
    projects: [
      "./vitest.unit.config.ts",
      "./vitest.architecture.config.ts",
      "./vitest.workers.config.ts",
    ],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: { lines: 90, branches: 90 },
    },
  },
});

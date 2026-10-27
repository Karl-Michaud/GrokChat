import { randomBytes } from "node:crypto";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

/**
 * workerd with real local D1, Durable Object and R2 bindings from wrangler.jsonc. The entry
 * re-exports the Worker and adds `TestAccountPublisher` (binding TEST_ACCOUNT): the production
 * Durable Object with scripted X ports, for the concurrency tests (plan §4, PR 3).
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        main: "./tests/integration/support/entry.ts",
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // A fresh throwaway key per run: tests never see a real secret.
            GROKCHAT_TOKEN_KEYS: randomBytes(32).toString("base64"),
          },
          durableObjects: {
            TEST_ACCOUNT: { className: "TestAccountPublisher", useSQLite: true },
          },
        },
      }),
    ],
    test: {
      name: "workers",
      include: ["tests/integration/**/*.test.ts", "tests/contract/**/*.test.ts"],
      setupFiles: ["./tests/integration/support/apply_migrations.ts"],
    },
  };
});

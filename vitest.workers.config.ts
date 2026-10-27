import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

/** workerd with real local D1, Durable Object and R2 bindings from wrangler.jsonc. */
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {
    name: "workers",
    include: ["tests/integration/**/*.test.ts", "tests/contract/**/*.test.ts"],
  },
});

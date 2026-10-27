import type { D1Migration } from "cloudflare:test";
import type { Env as GrokChatEnv } from "../../src/frameworks/env";

declare global {
  namespace Cloudflare {
    // `env` from cloudflare:workers carries the bindings wrangler.jsonc declares, plus the test
    // bindings vitest.workers.config.ts adds.
    interface Env extends GrokChatEnv {
      readonly TEST_MIGRATIONS: D1Migration[];
    }
    // `exports` from cloudflare:workers is typed from the entry module.
    interface GlobalProps {
      mainModule: typeof import("./support/entry");
      durableNamespaces: "AccountPublisher" | "TestAccountPublisher";
    }
  }
}

import type { Env as GrokChatEnv } from "../../src/frameworks/env";

declare global {
  namespace Cloudflare {
    // `env` from cloudflare:workers carries the bindings wrangler.jsonc declares.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration merging needs an interface
    interface Env extends GrokChatEnv {}
    // `exports` from cloudflare:workers is typed from the entry module.
    interface GlobalProps {
      mainModule: typeof import("../../src/main");
      durableNamespaces: "AccountPublisher";
    }
  }
}

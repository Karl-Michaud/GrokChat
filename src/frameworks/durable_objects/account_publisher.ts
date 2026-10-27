import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";

/**
 * One instance per account (plan §3.5). Declared now so the binding and its SQLite migration exist
 * from the first PR; the publish, recovery, token and mutex code arrives in PR 3.
 */
export class AccountPublisher extends DurableObject<Env> {}

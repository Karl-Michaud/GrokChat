import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";

/** Drops every binding's data (D1 tables included), then applies the migrations again. */
export async function freshStorage(): Promise<void> {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
}

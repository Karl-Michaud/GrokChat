/// <reference types="@cloudflare/workers-types" />
// The directive pulls Workers types past "types": [], so tsc accepts this file; ESLint must not.
export async function leak(db: D1Database): Promise<unknown> {
  return db.prepare("SELECT 1").first();
}

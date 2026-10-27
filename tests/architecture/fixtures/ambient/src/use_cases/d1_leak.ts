// A use case that reaches for Workers globals. tsconfig.inner.json must reject all three names.
export async function leak(db: D1Database): Promise<unknown> {
  return db.prepare("SELECT 1").first();
}

export const response: Response | undefined = undefined;

export const send = fetch;

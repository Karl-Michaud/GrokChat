// fixture: an inner layer must not see Workers ambient types
export async function leak(db: D1Database): Promise<unknown> { return db.prepare("SELECT 1").first(); }
export const r: Response | undefined = undefined;
export const f = fetch;

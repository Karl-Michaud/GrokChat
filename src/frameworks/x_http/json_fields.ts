/**
 * Reading X's JSON without trusting its shape: each accessor returns null for anything that is
 * not what it expects, so a driver maps a malformed body instead of throwing inside the DO.
 */
export function field(value: unknown, key: string | number): unknown {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return (value as Record<string | number, unknown>)[key] ?? null;
}

export function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? (value as readonly unknown[]) : [];
}

/** Parses a body as JSON, or null when it is empty or not JSON. */
export async function readJson(response: Response): Promise<unknown> {
  const body = await response.text();
  try {
    return body === "" ? null : (JSON.parse(body) as unknown);
  } catch {
    return null;
  }
}

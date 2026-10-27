import type { Context } from "hono";

/** A parsed urlencoded or multipart form: text fields only, files ignored. */
export interface FormBody {
  /** The first value of the field, "" when absent. */
  one(name: string): string;
  /** Every value of the field, in order. */
  all(name: string): readonly string[];
  /** A checkbox: present with any value. */
  checked(name: string): boolean;
}

/** Parsed once per request (Hono caches the body), so the CSRF check and the route share it. */
export async function formBody(c: Context): Promise<FormBody> {
  const body = await c.req.parseBody({ all: true });
  const all = (name: string): readonly string[] => {
    const value = body[name];
    const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
    return values.filter((item): item is string => typeof item === "string");
  };
  return {
    one: (name) => all(name)[0] ?? "",
    all,
    checked: (name) => all(name).length > 0,
  };
}

/** The first value of each named field, as a record. */
export function fields<const Name extends string>(
  body: FormBody,
  names: readonly Name[],
): Record<Name, string> {
  return Object.fromEntries(names.map((name) => [name, body.one(name)])) as Record<Name, string>;
}

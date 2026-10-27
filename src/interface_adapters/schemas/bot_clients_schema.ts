import { z } from "zod";

/** One bot client in `GROKCHAT_BOT_CLIENTS` (plan §3.5): never the token, only its SHA-256. */
export interface BotClientEntry {
  readonly id: string;
  /** Lower-case hex, 64 characters. */
  readonly tokenSha256: string;
  readonly accounts: readonly string[];
}

const entry = z.strictObject({
  id: z.string().min(1).max(128),
  tokenSha256: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .transform((hex) => hex.toLowerCase()),
  accounts: z.array(z.string().min(1).max(128)),
});

/** Two entries with one id or one token hash would make a caller ambiguous: refuse the list. */
const clients = z
  .array(entry)
  .refine((list) => new Set(list.map((item) => item.id)).size === list.length)
  .refine((list) => new Set(list.map((item) => item.tokenSha256)).size === list.length);

/** Why the secret was refused: logged by name, never with the value. */
export type BotClientsProblem = "missing" | "not_json" | "invalid";

export type BotClientsParse =
  | { readonly ok: true; readonly clients: readonly BotClientEntry[] }
  | { readonly ok: false; readonly problem: BotClientsProblem };

function parseJson(raw: string): { readonly json: unknown } | null {
  try {
    return { json: JSON.parse(raw) };
  } catch {
    return null;
  }
}

/**
 * Parses the secret's JSON. Anything malformed fails closed: no client is accepted, and the
 * zod issues are not passed on (they could quote the secret).
 */
export function parseBotClients(raw: string | undefined): BotClientsParse {
  if (raw === undefined) {
    return { ok: false, problem: "missing" };
  }
  const parsed = parseJson(raw);
  if (parsed === null) {
    return { ok: false, problem: "not_json" };
  }
  const checked = clients.safeParse(parsed.json);
  return checked.success ? { ok: true, clients: checked.data } : { ok: false, problem: "invalid" };
}

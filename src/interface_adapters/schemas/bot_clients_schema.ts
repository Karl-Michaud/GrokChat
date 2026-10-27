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
  .refine((list) => new Set(list.map((item) => item.id)).size === list.length, "duplicate id")
  .refine(
    (list) => new Set(list.map((item) => item.tokenSha256)).size === list.length,
    "duplicate tokenSha256",
  );

export type BotClientsParse =
  { readonly ok: true; readonly clients: readonly BotClientEntry[] } | { readonly ok: false };

/**
 * Parses the secret's JSON. Anything malformed fails closed: no client is accepted, and the
 * reason is not echoed (it could quote the secret).
 */
export function parseBotClients(raw: string | undefined): BotClientsParse {
  if (raw === undefined) {
    return { ok: false };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  const parsed = clients.safeParse(json);
  return parsed.success ? { ok: true, clients: parsed.data } : { ok: false };
}

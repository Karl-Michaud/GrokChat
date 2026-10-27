import { hasSchemeUrl } from "../text/post_text";

/** The X calls GrokChat makes, as priced (plan §1.1, §2). */
export type XOperation =
  | { readonly kind: "create"; readonly text: string }
  | { readonly kind: "delete" }
  | { readonly kind: "read"; readonly resources: number }
  | { readonly kind: "media_upload" }
  | { readonly kind: "oauth" };

export type XOperationKind = XOperation["kind"];

/** Money in millionths of a US dollar, so sums are exact. */
export type CostEstimate =
  { readonly kind: "usd"; readonly micros: number } | { readonly kind: "unknown" };

/** X's pay-per-use prices, 2026-10-27, in micro-dollars (plan §1.1). */
export const PRICES = {
  create: 15_000,
  createWithUrl: 200_000,
  delete: 10_000,
  read: 5_000,
  ownedRead: 1_000,
} as const;

const usd = (micros: number): CostEstimate => ({ kind: "usd", micros });

/**
 * A post with a scheme URL (`https://…`) is billed "with URL" at $0.20; a bare domain is billed as
 * a plain post at $0.015 (U4). Reads are owned reads at $0.001 only for the app owner's account.
 * Media upload has no price row; OAuth calls are free (U1).
 */
export function estimateCost(operation: XOperation, isAppOwner: boolean): CostEstimate {
  switch (operation.kind) {
    case "create":
      return usd(hasSchemeUrl(operation.text) ? PRICES.createWithUrl : PRICES.create);
    case "delete":
      return usd(PRICES.delete);
    case "read":
      return usd(operation.resources * (isAppOwner ? PRICES.ownedRead : PRICES.read));
    case "media_upload":
      return { kind: "unknown" };
    case "oauth":
      return usd(0);
  }
}

export interface Recent { readonly sentToday: number; readonly lastSentAt: number | null }
export type Verdict = { readonly kind: "allowed" } | { readonly kind: "refused"; readonly reason: "cap" | "gap" };
export function checkPublishable(now: number, recent: Recent, cap: number, minGapMs: number): Verdict {
  if (recent.sentToday >= cap) return { kind: "refused", reason: "cap" };
  if (recent.lastSentAt !== null && now - recent.lastSentAt < minGapMs) return { kind: "refused", reason: "gap" };
  return { kind: "allowed" };
}

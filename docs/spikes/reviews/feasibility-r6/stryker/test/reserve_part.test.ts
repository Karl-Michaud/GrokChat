import { it, expect } from "vitest";
import { reservePart, type PartStore } from "../src/use_cases/reserve_part";
const store = (sentToday: number, mark: "ok" | "conflict"): PartStore & { calls: number } => {
  const s = { calls: 0, recent: async () => ({ sentToday, lastSentAt: null }), markSending: async () => { s.calls++; return mark; } };
  return s;
};
it("reserves when allowed", async () => { const s = store(0, "ok"); expect(await reservePart(s, "a", "p", 1, 3, 0, 3, 0)).toBe("reserved"); expect(s.calls).toBe(1); });
it("conflict maps through", async () => { expect(await reservePart(store(0, "conflict"), "a", "p", 1, 3, 0, 3, 0)).toBe("conflict"); });
it("refused never writes", async () => { const s = store(3, "ok"); expect(await reservePart(s, "a", "p", 1, 3, 0, 3, 0)).toBe("refused:cap"); expect(s.calls).toBe(0); });

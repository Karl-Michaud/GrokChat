import { it, expect } from "vitest";
import { checkPublishable } from "../src/entities/policy";
it("cap boundary", () => {
  expect(checkPublishable(0, { sentToday: 2, lastSentAt: null }, 3, 0)).toEqual({ kind: "allowed" });
  expect(checkPublishable(0, { sentToday: 3, lastSentAt: null }, 3, 0)).toEqual({ kind: "refused", reason: "cap" });
});
it("gap boundary", () => {
  expect(checkPublishable(1000, { sentToday: 0, lastSentAt: 500 }, 3, 500)).toEqual({ kind: "allowed" });
  expect(checkPublishable(999, { sentToday: 0, lastSentAt: 500 }, 3, 500)).toEqual({ kind: "refused", reason: "gap" });
});
it("no previous send is never a gap refusal", () => {
  expect(checkPublishable(10, { sentToday: 0, lastSentAt: null }, 3, 1_000_000)).toEqual({ kind: "allowed" });
});

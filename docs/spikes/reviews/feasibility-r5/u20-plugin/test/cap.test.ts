import { it, expect } from "vitest";
import { underCap } from "../src/entities/cap";
it("cap", () => { expect(underCap(2, 3)).toBe(true); expect(underCap(3, 3)).toBe(false); expect(underCap(4, 3)).toBe(false); });

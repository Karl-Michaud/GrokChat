import { describe, expect, it } from "vitest";
import { currentHealth, SERVICE_NAME } from "../../../src/entities/health";

describe("currentHealth", () => {
  it("reports the service as ok", () => {
    expect(currentHealth()).toStrictEqual({ service: "grokchat", status: "ok" });
  });

  it("names the service grokchat", () => {
    expect(SERVICE_NAME).toBe("grokchat");
  });

  it("returns a frozen value, so no caller can change it", () => {
    expect(Object.isFrozen(currentHealth())).toBe(true);
  });
});

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanPorts } from "./port_scan";
import { FIXTURES, REPO_ROOT } from "./run_tool";

describe("port signatures use entity types only (plan §3.2, §6)", () => {
  it("every port in src/use_cases/ports/", () => {
    expect(scanPorts(join(REPO_ROOT, "tsconfig.inner.json"), REPO_ROOT)).toStrictEqual([]);
  });

  it("flags a port that names a vendor type (fixture)", () => {
    const root = join(FIXTURES, "ports");
    const found = scanPorts(join(root, "tsconfig.json"), root);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ file: "src/use_cases/ports/vendor_port.ts", type: "Context" });
    expect(found[0]?.declaredIn).toContain("node_modules/hono/");
  });
});

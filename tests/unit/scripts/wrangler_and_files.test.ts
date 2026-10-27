import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { options, UsageError } from "../../../scripts/deploy/cli.mjs";
import { LocalFiles } from "../../../scripts/deploy/local_files.mjs";
import {
  masked,
  secretNames,
  spawnRun,
  WranglerSecrets,
  type Run,
} from "../../../scripts/deploy/wrangler_secrets.mjs";
import { ok, recorder } from "./support";

const SECRET = "s3cret-value-never-printed";

function recordingRun(result = ok()) {
  const calls: { command: string; args: readonly string[]; input: string | undefined }[] = [];
  const run: Run = (command, args, input) => {
    calls.push({ command, args, input });
    return result;
  };
  return { calls, run };
}

describe("WranglerSecrets", () => {
  it("puts a secret over stdin, never in the arguments or the log", () => {
    const { calls, run } = recordingRun();
    const { lines, log } = recorder();
    new WranglerSecrets({ run, log, dryRun: false }).put("NAME", SECRET);
    expect(calls).toStrictEqual([
      { command: "npx", args: ["wrangler", "secret", "put", "NAME"], input: SECRET },
    ]);
    expect(lines).toStrictEqual(["NAME set."]);
  });

  it("in a dry run, runs nothing and prints the command with the value masked", () => {
    const { calls, run } = recordingRun();
    const { lines, log } = recorder();
    const secrets = new WranglerSecrets({ run, log, dryRun: true });
    secrets.put("NAME", SECRET);
    expect(secrets.names([])).toStrictEqual(new Set());
    expect(secrets.names(["A", "B"])).toStrictEqual(new Set(["A", "B"]));
    expect(calls).toStrictEqual([]);
    expect(lines).toStrictEqual([
      `would run: npx wrangler secret put NAME  (stdin: <${String(SECRET.length)} characters, masked>)`,
      "would run: npx wrangler secret list --format json  (dry run: assumed set: none)",
      "would run: npx wrangler secret list --format json  (dry run: assumed set: A, B)",
    ]);
    expect(lines.join("\n")).not.toContain(SECRET);
  });

  it("lists the names of the Worker's secrets as JSON", () => {
    const listed = JSON.stringify([{ name: "A", type: "secret_text" }, { name: "B" }]);
    const { calls, run } = recordingRun(ok(listed));
    const secrets = new WranglerSecrets({ run, log: () => undefined, dryRun: false });
    expect(secrets.names([])).toStrictEqual(new Set(["A", "B"]));
    expect(calls[0]?.args).toStrictEqual(["wrangler", "secret", "list", "--format", "json"]);
    expect(calls[0]?.input).toBeUndefined();
  });

  it("fails loudly, without a value, when wrangler fails", () => {
    const { run } = recordingRun({ status: 1, stdout: "" });
    const secrets = new WranglerSecrets({ run, log: () => undefined, dryRun: false });
    expect(() => {
      secrets.put("NAME", SECRET);
    }).toThrow("`wrangler secret put NAME` failed");
    expect(() => secrets.names([])).toThrow("`wrangler secret list` failed");
    const killed = new WranglerSecrets({
      run: () => ({ status: null, stdout: "" }),
      log: () => undefined,
      dryRun: false,
    });
    expect(() => {
      killed.put("NAME", SECRET);
    }).toThrow("failed");
  });

  it("reads only well-formed entries of the list", () => {
    expect(secretNames('[{"name":"A"},{"name":1},null,"B",{}]')).toStrictEqual(["A"]);
    expect(() => secretNames("not json")).toThrow("did not print JSON");
    expect(() => secretNames("{}")).toThrow("did not print a list");
  });

  it("masks by length only", () => {
    expect(masked("abc")).toBe("<3 characters, masked>");
  });
});

describe("spawnRun", () => {
  it("pipes the input to the command's stdin and captures stdout", () => {
    const script = "process.stdin.on('data', (d) => process.stdout.write(String(d).toUpperCase()))";
    expect(spawnRun(process.execPath, ["-e", script], "piped")).toStrictEqual({
      status: 0,
      stdout: "PIPED",
    });
    expect(spawnRun(process.execPath, ["-e", "process.exit(3)"])).toStrictEqual({
      status: 3,
      stdout: "",
    });
  });
});

describe("LocalFiles", () => {
  it("writes owner-only (600), also over an existing file, and reads back", () => {
    const dir = mkdtempSync(join(tmpdir(), "grokchat-files-"));
    const path = join(dir, "secret.local");
    writeFileSync(path, "old", { mode: 0o644 });
    const files = new LocalFiles({ log: () => undefined, dryRun: false });
    files.writePrivate(path, "new");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).toBe("new");
    expect(files.read(path)).toBe("new");
    expect(files.read(join(dir, "missing"))).toBeNull();
  });

  it("writes nothing in a dry run, and says which file it would write", () => {
    const dir = mkdtempSync(join(tmpdir(), "grokchat-files-"));
    const path = join(dir, "secret.local");
    const { lines, log } = recorder();
    new LocalFiles({ log, dryRun: true }).writePrivate(path, SECRET);
    expect(new LocalFiles({ log, dryRun: true }).read(path)).toBeNull();
    expect(lines).toStrictEqual([`would write ${path} (mode 600)`]);
  });
});

describe("options", () => {
  it("parses the declared flags and refuses anything else as a UsageError", () => {
    const declared = { "dry-run": { type: "boolean" }, id: { type: "string" } } as const;
    expect({ ...options(["--dry-run", "--id", "a"], declared) }).toStrictEqual({
      "dry-run": true,
      id: "a",
    });
    expect(() => options(["--nope"], declared)).toThrow(UsageError);
    expect(() => options(["stray"], declared)).toThrow(UsageError);
  });
});

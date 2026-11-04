/** The deploy scripts as the owner runs them, in --dry-run: nothing runs, nothing is written. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function script(name: string, args: readonly string[], cwd: string) {
  const path = join(import.meta.dirname, "../../../scripts", name);
  const result = spawnSync(process.execPath, [path, ...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const workdir = () => mkdtempSync(join(tmpdir(), "grokchat-cli-"));

describe("the deploy scripts in a dry run", () => {
  it("provision-secrets prints each command, values masked, and writes no file", () => {
    const cwd = workdir();
    writeFileSync(
      join(cwd, "x.env"),
      "X_CLIENT_ID=the-id-value\nX_CLIENT_SECRET=the-secret-value\n",
    );
    const run = script("provision-secrets.mjs", ["--dry-run", "--env-file", "x.env"], cwd);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("would run: npx wrangler secret list --format json");
    for (const name of ["GROKCHAT_TOKEN_KEYS", "GROKCHAT_SESSION_SECRET", "X_CLIENT_SECRET"]) {
      expect(run.stdout).toMatch(
        new RegExp(`secret put ${name} {2}\\(stdin: <\\d+ characters, masked>\\)`),
      );
    }
    expect(run.stdout).toContain("would write .token-keys.local (mode 600)");
    expect(run.stdout).not.toMatch(/the-id-value|the-secret-value/);
    expect(readdirSync(cwd)).toStrictEqual(["x.env"]);
  });

  it("import-bots prints the execute it would run and the people, never a hash", () => {
    const cwd = workdir();
    const hash = "c".repeat(64);
    const list = [{ id: "karl", tokenSha256: hash, accounts: ["acc-1"] }];
    writeFileSync(join(cwd, ".bot-clients.local.json"), JSON.stringify(list));
    const run = script("import-bots.mjs", ["--dry-run"], cwd);
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(
      "would run: npx wrangler d1 execute grokchat --remote --yes --file <3 statements>  (dry run)\n" +
        "people: Karl (karl); account assignments: 1\n",
    );
    expect(readdirSync(cwd)).toStrictEqual([".bot-clients.local.json"]);
  });

  it("fail with a message and exit 1 on bad use, and set-admin-password needs a terminal", () => {
    const cwd = workdir();
    const bot = script("import-bots.mjs", ["--dry-run"], cwd);
    expect([bot.status, bot.stderr]).toStrictEqual([
      1,
      "error: .bot-clients.local.json is missing: copy it from the machine that ran add-bot\n",
    ]);
    const unknown = script("provision-secrets.mjs", ["--nope"], cwd);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toMatch(/^error: Unknown option '--nope'/);
    const password = script("set-admin-password.mjs", ["--dry-run"], cwd);
    expect([password.status, password.stderr]).toStrictEqual([
      1,
      "error: run this in a terminal: the password is read unechoed\n",
    ]);
  });
});

describe(".gitignore", () => {
  it("ignores the scripts' local files", () => {
    const lines = readFileSync(join(import.meta.dirname, "../../../.gitignore"), "utf8").split(
      "\n",
    );
    for (const file of [".token-keys.local", ".bot-tokens.local", ".bot-clients.local.json"]) {
      expect(lines).toContain(file);
    }
  });
});

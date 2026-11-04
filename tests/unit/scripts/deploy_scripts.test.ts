import { describe, expect, it } from "vitest";
import { importBots } from "../../../scripts/import-bots.mjs";
import { importStatements, personNameOf } from "../../../scripts/deploy/import_sql.mjs";
import { UsageError } from "../../../scripts/deploy/cli.mjs";
import { newTokenKey, parseTokenKeys } from "../../../scripts/deploy/secret_values.mjs";
import { provisionSecrets } from "../../../scripts/provision-secrets.mjs";
import { setAdminPassword } from "../../../scripts/set-admin-password.mjs";
import { FakeFiles, FakeSecrets, recorder } from "./support";

describe("set-admin-password", () => {
  const answers = (...values: string[]) => {
    const questions: string[] = [];
    return {
      questions,
      prompt: (question: string) => {
        questions.push(question);
        return Promise.resolve(values.shift() ?? "");
      },
    };
  };

  it("asks twice and puts only the hash, never logging the password or the hash", async () => {
    const { prompt, questions } = answers("a strong password", "a strong password");
    const secrets = new FakeSecrets();
    const { lines, log } = recorder();
    await setAdminPassword({ prompt, secrets, log });
    expect(questions).toHaveLength(2);
    const hash = secrets.value("GROKCHAT_ADMIN_PASSWORD_HASH");
    expect(hash).toMatch(/^pbkdf2-sha256\$100000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(secrets.puts).toHaveLength(1);
    expect(lines.join("\n")).not.toMatch(/strong password|pbkdf2/);
  });

  it.each([
    ["short one", "short one", "the password is shorter than 12 characters; nothing was set"],
    ["a strong password", "a strong passw0rd", "the two entries differ; nothing was set"],
  ])("refuses %j / %j and sets nothing", async (first, second, message) => {
    const secrets = new FakeSecrets();
    const run = setAdminPassword({ prompt: answers(first, second).prompt, secrets, log: () => 0 });
    await expect(run).rejects.toThrow(new UsageError(message));
    expect(secrets.puts).toStrictEqual([]);
  });
});

const ENV_FILE = "X_CLIENT_ID=client-id\nX_CLIENT_SECRET='client secret'\n# comment\n";
const flags = (overrides: Partial<Parameters<typeof provisionSecrets>[0]> = {}) => ({
  rotate: false,
  dropOldTokenKeys: false,
  replaceTokenKeys: false,
  envFile: "x.env",
  tokenKeysFile: ".token-keys.local",
  ...overrides,
});

function provisioning(set: readonly string[] = [], files = new FakeFiles()) {
  files.texts.set("x.env", ENV_FILE);
  const secrets = new FakeSecrets(set);
  const { lines, log } = recorder();
  return { secrets, files, lines, log, deps: { secrets, files, log } };
}

describe("provision-secrets", () => {
  it("on a new Worker sets all four, keeps the token keys locally, and prints no value", () => {
    const { secrets, files, lines, deps } = provisioning();
    provisionSecrets(flags(), deps);
    expect(secrets.puts.map((put) => put.name)).toStrictEqual([
      "GROKCHAT_TOKEN_KEYS",
      "GROKCHAT_SESSION_SECRET",
      "X_CLIENT_ID",
      "X_CLIENT_SECRET",
    ]);
    const keys = secrets.value("GROKCHAT_TOKEN_KEYS");
    expect(parseTokenKeys(keys)).toHaveLength(1);
    expect(files.texts.get(".token-keys.local")).toBe(`${keys}\n`);
    expect(secrets.value("GROKCHAT_SESSION_SECRET")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secrets.value("X_CLIENT_ID")).toBe("client-id");
    expect(secrets.value("X_CLIENT_SECRET")).toBe("client secret");
    const printed = lines.join("\n");
    for (const put of secrets.puts) {
      expect(printed).not.toContain(put.value);
    }
  });

  it("keeps what is already set, and then needs no env file", () => {
    const all = [
      "GROKCHAT_TOKEN_KEYS",
      "GROKCHAT_SESSION_SECRET",
      "X_CLIENT_ID",
      "X_CLIENT_SECRET",
    ];
    const { secrets, files, lines, deps } = provisioning(all);
    provisionSecrets(flags({ envFile: undefined }), deps);
    expect(secrets.puts).toStrictEqual([]);
    expect(files.writes).toStrictEqual([]);
    expect(lines).toStrictEqual([
      "GROKCHAT_TOKEN_KEYS already set; kept.",
      "GROKCHAT_SESSION_SECRET already set; kept.",
    ]);
  });

  it("refuses, before setting anything, when an X credential is needed and not in the env file", () => {
    const missing = provisioning(["X_CLIENT_ID"]);
    expect(() => {
      provisionSecrets(flags({ envFile: undefined }), missing.deps);
    }).toThrow("X_CLIENT_SECRET not set: pass --env-file <path> that holds them");
    const none = provisioning();
    expect(() => {
      provisionSecrets(flags({ envFile: undefined }), none.deps);
    }).toThrow("X_CLIENT_ID and X_CLIENT_SECRET not set");
    expect(() => {
      provisionSecrets(flags({ envFile: "nope.env" }), none.deps);
    }).toThrow("--env-file nope.env does not exist");
    none.files.texts.set("x.env", "X_CLIENT_ID=id\nX_CLIENT_SECRET=  \n");
    expect(() => {
      provisionSecrets(flags(), none.deps);
    }).toThrow("--env-file x.env has no X_CLIENT_SECRET");
    expect([...missing.secrets.puts, ...none.secrets.puts]).toStrictEqual([]);
  });

  it("--rotate sets everything again, with a new token key in front of the current ones", () => {
    const current = newTokenKey();
    const files = new FakeFiles();
    files.texts.set(".token-keys.local", `${current}\n`);
    const { secrets, deps } = provisioning(
      ["GROKCHAT_TOKEN_KEYS", "GROKCHAT_SESSION_SECRET"],
      files,
    );
    provisionSecrets(flags({ rotate: true }), deps);
    const keys = parseTokenKeys(secrets.value("GROKCHAT_TOKEN_KEYS"));
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(current);
    expect(files.texts.get(".token-keys.local")).toBe(`${keys.join(",")}\n`);
    expect(secrets.puts.map((put) => put.name)).toHaveLength(4);
  });

  it("--drop-old-token-keys keeps only the newest key and leaves the rest", () => {
    const [newest, old] = [newTokenKey(), newTokenKey()];
    const files = new FakeFiles();
    files.texts.set(".token-keys.local", `${newest},${old}\n`);
    const all = [
      "GROKCHAT_TOKEN_KEYS",
      "GROKCHAT_SESSION_SECRET",
      "X_CLIENT_ID",
      "X_CLIENT_SECRET",
    ];
    const { secrets, deps } = provisioning(all, files);
    provisionSecrets(flags({ dropOldTokenKeys: true }), deps);
    expect(secrets.puts).toStrictEqual([{ name: "GROKCHAT_TOKEN_KEYS", value: newest }]);
  });

  it("never replaces set token keys without the current ones unless told to", () => {
    const { secrets, deps } = provisioning(["GROKCHAT_TOKEN_KEYS"]);
    expect(() => {
      provisionSecrets(flags({ rotate: true }), deps);
    }).toThrow(/is missing: new keys without the current ones/);
    expect(secrets.puts).toStrictEqual([]);
    provisionSecrets(flags({ rotate: true, replaceTokenKeys: true }), deps);
    expect(parseTokenKeys(secrets.value("GROKCHAT_TOKEN_KEYS"))).toHaveLength(1);
  });

  it("refuses --rotate with --drop-old-token-keys", () => {
    const { deps } = provisioning();
    expect(() => {
      provisionSecrets(flags({ rotate: true, dropOldTokenKeys: true }), deps);
    }).toThrow("pass --rotate or --drop-old-token-keys, not both");
  });

  it("asks the dry run to assume every secret set when rotating, none otherwise", () => {
    const assumed: (readonly string[])[] = [];
    const files = new FakeFiles();
    files.texts.set(".token-keys.local", newTokenKey());
    files.texts.set("x.env", ENV_FILE);
    const secrets = {
      names: (list: readonly string[]) => {
        assumed.push(list);
        return new Set(list);
      },
      put: () => undefined,
    };
    provisionSecrets(flags(), { secrets, files, log: () => undefined });
    provisionSecrets(flags({ rotate: true }), { secrets, files, log: () => undefined });
    provisionSecrets(flags({ dropOldTokenKeys: true }), { secrets, files, log: () => undefined });
    expect(assumed.map((list) => list.length)).toStrictEqual([0, 4, 4]);
  });
});

const HASH_K = "a".repeat(64);
const HASH_A = "b".repeat(64);
const LIST = [
  { id: "karl", tokenSha256: HASH_K, accounts: ["acc-1", "acc-2"] },
  { id: "aaron", tokenSha256: HASH_A, accounts: ["acc-3"] },
];

function importDeps(text: string | null, status = 0) {
  const files = new FakeFiles();
  if (text !== null) {
    files.texts.set(".bot-clients.local.json", text);
  }
  const runs: { command: string; args: readonly string[] }[] = [];
  const sql: string[] = [];
  const { lines, log } = recorder();
  return {
    runs,
    sql,
    lines,
    deps: {
      files,
      log,
      run: (command: string, args: readonly string[]) => {
        runs.push({ command, args });
        return { status, stdout: "" };
      },
      writeSql: (body: string) => {
        sql.push(body);
        return "/tmp/import.sql";
      },
    },
  };
}

const importFlags = { file: ".bot-clients.local.json", dryRun: false, now: 1_000 };

describe("import-bots (GROKCHAT-16)", () => {
  it("runs the import's statements on the REMOTE database, and prints no hash", () => {
    const { runs, sql, lines, deps } = importDeps(JSON.stringify(LIST));
    importBots(importFlags, deps);
    expect(runs).toStrictEqual([
      {
        command: "npx",
        args: [
          "wrangler",
          "d1",
          "execute",
          "grokchat",
          "--remote",
          "--yes",
          "--file",
          "/tmp/import.sql",
        ],
      },
    ]);
    expect(sql).toStrictEqual([`${importStatements(LIST, 1_000).join("\n")}\n`]);
    const said = lines.join("\n");
    expect(said).toContain("Imported Karl (karl), Aaron (aaron) with 3 account assignment(s)");
    expect(said).toContain("delete GROKCHAT_BOT_CLIENTS");
    expect(said).not.toContain(HASH_K);
  });

  it("in a dry run, says what it would run and runs nothing", () => {
    const { runs, sql, lines, deps } = importDeps(JSON.stringify(LIST));
    importBots({ ...importFlags, dryRun: true }, deps);
    expect([runs, sql]).toStrictEqual([[], []]);
    expect(lines).toStrictEqual([
      "would run: npx wrangler d1 execute grokchat --remote --yes --file <7 statements>  (dry run)",
      "people: Karl (karl), Aaron (aaron); account assignments: 3",
    ]);
    const empty = importDeps("[]");
    importBots({ ...importFlags, dryRun: true }, empty.deps);
    expect(empty.lines[1]).toBe("people: none; account assignments: 0");
    importBots(importFlags, empty.deps);
    expect(empty.lines[2]).toMatch(/^Imported nobody with 0 account assignment/);
  });

  it("refuses a missing, non-JSON or malformed list without quoting it, and a failed execute", () => {
    expect(() => {
      importBots(importFlags, importDeps(null).deps);
    }).toThrow(".bot-clients.local.json is missing: copy it from the machine that ran add-bot");
    expect(() => {
      importBots(importFlags, importDeps("not json").deps);
    }).toThrow(".bot-clients.local.json is not JSON");
    const leaked = importDeps('[{"id":"x","token":"leaked"}]');
    expect(() => {
      importBots(importFlags, leaked.deps);
    }).toThrow(".bot-clients.local.json is not a bot client list");
    expect(() => {
      importBots(importFlags, leaked.deps);
    }).not.toThrow(/leaked/);
    expect(leaked.runs).toStrictEqual([]);
    expect(() => {
      importBots(importFlags, importDeps(JSON.stringify(LIST), 1).deps);
    }).toThrow("`wrangler d1 execute` failed");
  });
});

describe("the import's statements", () => {
  it("name each person after its id, quote values, and only fill what is missing", () => {
    expect(personNameOf("karl")).toBe("Karl");
    expect(personNameOf("x")).toBe("X");
    const [insert, token, assign] = importStatements(
      [{ id: "o", tokenSha256: HASH_K, accounts: ["it's"] }],
      7,
    );
    expect(insert).toBe(
      "INSERT INTO people (id, name, token_sha256, token_created_at, created_at) " +
        `SELECT 'o', 'O', '${HASH_K}', 7, 7 WHERE NOT EXISTS (SELECT 1 FROM people WHERE ` +
        `token_sha256 = '${HASH_K}') ON CONFLICT DO NOTHING;`,
    );
    expect(token).toBe(
      `UPDATE people SET token_sha256 = '${HASH_K}', token_created_at = 7 WHERE id = 'o' AND ` +
        `token_sha256 IS NULL AND NOT EXISTS (SELECT 1 FROM people WHERE token_sha256 = '${HASH_K}');`,
    );
    expect(assign).toBe(
      "UPDATE accounts SET person_id = 'o' WHERE id = 'it''s' AND person_id IS NULL AND " +
        "EXISTS (SELECT 1 FROM people WHERE id = 'o');",
    );
  });
});

import { describe, expect, it } from "vitest";
import { addBot } from "../../../scripts/add-bot.mjs";
import { UsageError } from "../../../scripts/deploy/cli.mjs";
import { checkBotClients } from "../../../scripts/deploy/bot_clients.mjs";
import { newTokenKey, parseTokenKeys, sha256Hex } from "../../../scripts/deploy/secret_values.mjs";
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

const bot = (overrides: Partial<Parameters<typeof addBot>[0]> = {}) => ({
  id: "muse-bot",
  accounts: "acc-1,acc-2",
  clientsFile: ".bot-clients.local.json",
  tokensFile: ".bot-tokens.local",
  newList: false,
  ...overrides,
});

describe("add-bot", () => {
  it("puts the list with the token's hash, writes the token only to the token file", async () => {
    const files = new FakeFiles();
    const secrets = new FakeSecrets();
    const { lines, log } = recorder();
    await addBot(bot(), { secrets, files, log });
    const [, token = ""] =
      /^muse-bot=(\S+)\n$/.exec(files.texts.get(".bot-tokens.local") ?? "") ?? [];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const list = [
      { id: "muse-bot", tokenSha256: await sha256Hex(token), accounts: ["acc-1", "acc-2"] },
    ];
    expect(JSON.parse(secrets.value("GROKCHAT_BOT_CLIENTS"))).toStrictEqual(list);
    const local = files.texts.get(".bot-clients.local.json") ?? "";
    expect(checkBotClients(JSON.parse(local))).toStrictEqual(list);
    expect(local).not.toContain(token);
    expect(secrets.value("GROKCHAT_BOT_CLIENTS")).not.toContain(token);
    expect(lines.join("\n")).not.toContain(token);
    expect(lines.join("\n")).toContain(".bot-tokens.local");
  });

  it("adds to the local list, and gives a bot added again a new token in place", async () => {
    const files = new FakeFiles();
    const secrets = new FakeSecrets();
    const deps = { secrets, files, log: () => undefined };
    await addBot(bot(), deps);
    await addBot(bot({ id: "other", accounts: "acc-3" }), deps);
    await addBot(bot({ accounts: "acc-9" }), deps);
    const list = checkBotClients(JSON.parse(secrets.puts.at(-1)?.value ?? ""));
    expect(list.map((c) => [c.id, c.accounts])).toStrictEqual([
      ["muse-bot", ["acc-9"]],
      ["other", ["acc-3"]],
    ]);
    const tokens = (files.texts.get(".bot-tokens.local") ?? "").trim().split("\n");
    expect(tokens.map((line) => line.split("=")[0])).toStrictEqual(["other", "muse-bot"]);
    const muse = tokens[1]?.split("=")[1] ?? "";
    expect(list[0]?.tokenSha256).toBe(await sha256Hex(muse));
  });

  it("refuses to overwrite a list set elsewhere unless --new-list", async () => {
    const secrets = new FakeSecrets(["GROKCHAT_BOT_CLIENTS"]);
    const files = new FakeFiles();
    const deps = { secrets, files, log: () => undefined };
    await expect(addBot(bot(), deps)).rejects.toThrow(/is missing: a new list would drop/);
    expect([secrets.puts, files.writes]).toStrictEqual([[], []]);
    await addBot(bot({ newList: true }), deps);
    expect(secrets.puts).toHaveLength(1);
  });

  it("refuses a bad id, bad accounts or a bad local list, before anything is written", async () => {
    const files = new FakeFiles();
    const secrets = new FakeSecrets();
    const deps = { secrets, files, log: () => undefined };
    await expect(addBot(bot({ id: "a b" }), deps)).rejects.toThrow("--id is 1 to 128 of");
    await expect(addBot(bot({ accounts: " , " }), deps)).rejects.toThrow(
      "--accounts takes one or more account ids",
    );
    files.texts.set(".bot-clients.local.json", '[{"id":"x","token":"leaked"}]');
    const refused = addBot(bot(), deps);
    await expect(refused).rejects.toThrow(".bot-clients.local.json is not a bot client list");
    await expect(addBot(bot(), deps)).rejects.not.toThrow(/leaked/);
    files.texts.set(".bot-clients.local.json", "not json");
    await expect(addBot(bot(), deps)).rejects.toThrow("is not a bot client list");
    expect([secrets.puts, files.writes]).toStrictEqual([[], []]);
  });
});

import { describe, expect, it } from "vitest";
import {
  checkBotClients,
  parseAccounts,
  validBotId,
  withBotClient,
  withTokenLine,
} from "../../../scripts/deploy/bot_clients.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe("the bot client list", () => {
  it("accepts exactly [{ id, tokenSha256, accounts }]", () => {
    const list = [{ id: "muse", tokenSha256: HASH_A, accounts: ["acc-1"] }];
    expect(checkBotClients(list)).toStrictEqual(list);
    expect(checkBotClients([])).toStrictEqual([]);
  });

  it.each([
    ["not a list", {}],
    ["a null entry", [null]],
    ["a token field", [{ id: "m", tokenSha256: HASH_A, accounts: [], token: "x" }]],
    ["an upper-case hash", [{ id: "m", tokenSha256: "A".repeat(64), accounts: [] }]],
    ["a bad id", [{ id: "m n", tokenSha256: HASH_A, accounts: [] }]],
    ["a non-string id", [{ id: 1, tokenSha256: HASH_A, accounts: [] }]],
    ["a non-string hash", [{ id: "m", tokenSha256: 1, accounts: [] }]],
    ["accounts not a list", [{ id: "m", tokenSha256: HASH_A, accounts: "acc" }]],
    ["an empty account", [{ id: "m", tokenSha256: HASH_A, accounts: [""] }]],
    ["a long account", [{ id: "m", tokenSha256: HASH_A, accounts: ["a".repeat(129)] }]],
    ["a non-string account", [{ id: "m", tokenSha256: HASH_A, accounts: [1] }]],
  ])("refuses %s, without quoting it", (_name, json) => {
    expect(() => checkBotClients(json)).toThrow(
      "the bot client list is not [{ id, tokenSha256, accounts }]",
    );
  });

  it("refuses one id or one hash twice", () => {
    const twice = "the bot client list names one id or one token hash twice";
    const a = { id: "a", tokenSha256: HASH_A, accounts: [] };
    expect(() => checkBotClients([a, { ...a, tokenSha256: HASH_B }])).toThrow(twice);
    expect(() => checkBotClients([a, { ...a, id: "b" }])).toThrow(twice);
  });

  it("adds a new bot at the end, and replaces a bot's entry in place", () => {
    const a = { id: "a", tokenSha256: HASH_A, accounts: ["1"] };
    const b = { id: "b", tokenSha256: HASH_B, accounts: ["2"] };
    expect(withBotClient([a], b)).toStrictEqual([a, b]);
    const newA = { id: "a", tokenSha256: "c".repeat(64), accounts: ["3"] };
    expect(withBotClient([a, b], newA)).toStrictEqual([newA, b]);
  });
});

describe("the bot's options", () => {
  it("takes ids of letters, digits, '_', '.', '-', up to 128", () => {
    expect(validBotId("muse-bot_1.v2")).toBe(true);
    expect(validBotId("a".repeat(128))).toBe(true);
    for (const bad of ["", "a".repeat(129), "a=b", "a b", "é"]) {
      expect(validBotId(bad)).toBe(false);
    }
  });

  it("takes one or more account ids, trimmed and without repeats", () => {
    expect(parseAccounts(" acc-1, acc-2,,acc-1 ")).toStrictEqual(["acc-1", "acc-2"]);
    expect(parseAccounts("a".repeat(128))).toHaveLength(1);
    for (const bad of ["", " , ", "a".repeat(129)]) {
      expect(() => parseAccounts(bad)).toThrow("--accounts takes one or more account ids");
    }
  });
});

describe("the local token file", () => {
  it("keeps one <id>=<token> line per bot, replacing the bot's old one", () => {
    expect(withTokenLine("", "a", "t1")).toBe("a=t1\n");
    expect(withTokenLine("a=t1\nb=t2\n", "a", "t3")).toBe("b=t2\na=t3\n");
    expect(withTokenLine("ab=t1\n", "a", "t2")).toBe("ab=t1\na=t2\n");
  });
});

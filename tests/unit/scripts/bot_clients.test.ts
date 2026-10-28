import { describe, expect, it } from "vitest";
import { checkBotClients, validBotId } from "../../../scripts/deploy/bot_clients.mjs";

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

  it("refuses one account given to two bots: an account belongs to one person", () => {
    const a = { id: "a", tokenSha256: HASH_A, accounts: ["1", "2"] };
    const b = { id: "b", tokenSha256: HASH_B, accounts: ["2"] };
    expect(() => checkBotClients([a, b])).toThrow(
      "the bot client list gives one account twice: a person owns an account alone",
    );
    expect(checkBotClients([a, { ...b, accounts: ["3"] }])).toHaveLength(2);
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
});

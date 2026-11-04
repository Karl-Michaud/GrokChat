import { describe, expect, it } from "vitest";
import { ALLOWED, refuse } from "../../../../src/entities/decision";
import { actorLabel, authorize, isHuman } from "../../../../src/entities/identity/actor";
import * as ids from "../../../../src/entities/identity/ids";
import { ACCOUNT, botActor, HUMAN, OTHER_ACCOUNT, SYSTEM } from "../../support/builders";

describe("authorize", () => {
  it("a bot only inside its scope; humans and the system everywhere", () => {
    expect(authorize(botActor([ACCOUNT]), ACCOUNT)).toStrictEqual({ allowed: true });
    expect(authorize(botActor([ACCOUNT]), OTHER_ACCOUNT)).toStrictEqual({
      allowed: false,
      reason: "scope",
    });
    expect(authorize(botActor([]), ACCOUNT).allowed).toBe(false);
    expect(authorize(HUMAN, OTHER_ACCOUNT).allowed).toBe(true);
    expect(authorize(SYSTEM, OTHER_ACCOUNT).allowed).toBe(true);
  });

  it("isHuman and actorLabel", () => {
    expect([isHuman(HUMAN), isHuman(SYSTEM), isHuman(botActor())]).toStrictEqual([
      true,
      false,
      false,
    ]);
    expect([actorLabel(HUMAN), actorLabel(SYSTEM), actorLabel(botActor())]).toStrictEqual([
      "human:owner",
      "system:cron",
      "bot:bot-1",
    ]);
  });
});

describe("ids and decisions", () => {
  it("brand constructors keep the string", () => {
    const makers = [
      ids.accountId,
      ids.postId,
      ids.botId,
      ids.xUserId,
      ids.xPostId,
      ids.xMediaId,
      ids.stagedMediaId,
      ids.idempotencyKey,
    ];
    expect(makers.map((make) => make("v"))).toStrictEqual(Array.from({ length: 8 }, () => "v"));
  });

  it("ALLOWED and refuse", () => {
    expect(ALLOWED).toStrictEqual({ allowed: true });
    expect(refuse("why")).toStrictEqual({ allowed: false, reason: "why" });
  });
});

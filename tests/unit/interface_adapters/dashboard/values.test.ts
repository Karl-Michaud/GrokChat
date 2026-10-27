import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MINUTE } from "../../../../src/entities/time/instant";
import {
  filled,
  formatClock,
  formatUtc,
  formatUtcDate,
  parseClock,
  parseLines,
  parseList,
  parseMinutes,
  parseUtcDate,
  parseUtcDateTime,
  parseWhole,
  startOfUtcDay,
  toDateTimeInput,
} from "../../../../src/interface_adapters/dashboard/form_values";
import {
  invalid,
  page,
  redirect,
  refused,
} from "../../../../src/interface_adapters/dashboard/outcome";
import { Presenter } from "../../../../src/interface_adapters/dashboard/presenter";
import { refusalView } from "../../../../src/interface_adapters/dashboard/refusals";
import {
  checkUnsafeRequest,
  constantTimeEqual,
} from "../../../../src/interface_adapters/dashboard/request_guard";
import { T0 } from "../../support/builders";

const T = Date.UTC(2026, 9, 27, 12, 30);

describe("form values (UTC)", () => {
  it("formats instants for display and for inputs", () => {
    expect(formatUtc(T)).toBe("2026-10-27 12:30 UTC");
    expect(toDateTimeInput(T + 59_999)).toBe("2026-10-27T12:30");
    expect(formatUtcDate(T)).toBe("2026-10-27");
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(22 * 60 + 5)).toBe("22:05");
    expect(startOfUtcDay(T)).toBe(Date.UTC(2026, 9, 27));
    expect(startOfUtcDay(Date.UTC(2026, 9, 27))).toBe(Date.UTC(2026, 9, 27));
  });

  it("reads exactly a datetime-local value, a date and a time of day", () => {
    expect(parseUtcDateTime("2026-10-27T12:30")).toBe(T);
    expect(parseUtcDateTime(" 2026-10-27T12:30 ")).toBe(T);
    expect(parseUtcDate("2026-10-27")).toBe(Date.UTC(2026, 9, 27));
    expect(parseUtcDate(" 2026-10-27 ")).toBe(Date.UTC(2026, 9, 27));
    expect(parseClock("07:45")).toBe(7 * 60 + 45);
    expect(parseClock(" 00:00 ")).toBe(0);
    for (const bad of [
      "2026-02-30T10:00",
      "2026-13-01T10:00",
      "2026-10-27T24:00",
      "2026-10-27",
      "x",
      "",
    ]) {
      expect(parseUtcDateTime(bad)).toBeNull();
    }
    for (const bad of ["2026-02-30", "2026-1-1", "2026-10-27T00:00", "27/10/2026", ""]) {
      expect(parseUtcDate(bad)).toBeNull();
    }
    for (const bad of ["24:00", "12:60", "7:45", "12:30:00", "noon", ""]) {
      expect(parseClock(bad)).toBeNull();
    }
  });

  it("round-trips every minute (fast-check)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_000_000_000 }), (minutes) => {
        const instant = minutes * MINUTE;
        expect(parseUtcDateTime(toDateTimeInput(instant))).toBe(instant);
        expect(parseUtcDate(formatUtcDate(instant))).toBe(startOfUtcDay(instant));
      }),
    );
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 24 * 60 - 1 }), (minute) => {
        expect(parseClock(formatClock(minute))).toBe(minute);
      }),
    );
  });

  it("reads whole numbers written plainly, and minutes", () => {
    expect(parseWhole("0")).toBe(0);
    expect(parseWhole(" 42 ")).toBe(42);
    for (const bad of ["-1", "1.5", "1e3", "007", "", "x", "9007199254740993"]) {
      expect(parseWhole(bad)).toBeNull();
    }
    expect(parseMinutes("30")).toBe(30 * MINUTE);
    expect(parseMinutes("x")).toBeNull();
    fc.assert(fc.property(fc.nat(), (n) => parseWhole(String(n)) === n));
  });

  it("splits lines and lists, dropping blanks", () => {
    expect(parseLines(" a \r\n\n b\n")).toStrictEqual(["a", "b"]);
    expect(parseLines("")).toStrictEqual([]);
    expect(parseList(" m-1, ,m-2 ")).toStrictEqual(["m-1", "m-2"]);
    expect(parseList("")).toStrictEqual([]);
    expect(filled(null)).toBeNull();
    expect(filled("  ")).toBeNull();
    expect(filled(" a ")).toBe("a");
  });
});

describe("the request guard (m4, R12)", () => {
  const base = {
    origin: "https://grokchat.example.workers.dev",
    expectedOrigin: "https://grokchat.example.workers.dev",
    sentToken: "tok-123",
    sessionToken: "tok-123",
  };

  it("passes the exact origin with the session's token", () => {
    expect(checkUnsafeRequest(base)).toBe("ok");
  });

  it("refuses a missing, different or look-alike origin", () => {
    expect(checkUnsafeRequest({ ...base, origin: null })).toBe("origin");
    expect(checkUnsafeRequest({ ...base, origin: "https://evil.workers.dev" })).toBe("origin");
    expect(checkUnsafeRequest({ ...base, origin: `${base.expectedOrigin}/` })).toBe("origin");
    expect(checkUnsafeRequest({ ...base, origin: "http://grokchat.example.workers.dev" })).toBe(
      "origin",
    );
  });

  it("refuses a missing or wrong token when there is a session", () => {
    expect(checkUnsafeRequest({ ...base, sentToken: null })).toBe("csrf");
    expect(checkUnsafeRequest({ ...base, sentToken: "tok-124" })).toBe("csrf");
    expect(checkUnsafeRequest({ ...base, sentToken: "" })).toBe("csrf");
  });

  it("needs only the origin before there is a session (the login form)", () => {
    expect(checkUnsafeRequest({ ...base, sessionToken: null, sentToken: null })).toBe("ok");
    expect(
      checkUnsafeRequest({ ...base, sessionToken: null, sentToken: null, origin: "https://x" }),
    ).toBe("origin");
  });

  it("compares strings exactly", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("", "")).toBe(true);
    expect(constantTimeEqual("abd", "abc")).toBe(false);
    expect(constantTimeEqual("bbc", "abc")).toBe(false);
    expect(constantTimeEqual("ab", "abc")).toBe(false);
    expect(constantTimeEqual("abcd", "abc")).toBe(false);
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => constantTimeEqual(a, b) === (a === b)),
    );
  });
});

describe("refusals and outcomes", () => {
  it("maps every known refusal code to its status and message", () => {
    const table = Object.fromEntries(
      [
        "not_found",
        "account_not_found",
        "personality_not_found",
        "scope",
        "human_only",
        "invalid_transition",
        "version_conflict",
        "not_deletable",
        "needs_reconnect",
        "different_x_user",
        "already_connected",
        "confirmation_required",
        "oauth_state",
        "oauth_failed",
        "personality_required",
        "name_required",
        "throttled",
        "wrong_password",
        "daily_cap",
        "min_gap",
        "quiet_hours",
        "tz",
        "grace",
        "no_parts",
        "too_many_parts",
        "link_policy",
      ].map((code) => [code, refusalView(code)]),
    );
    expect(table).toStrictEqual({
      not_found: { status: 404, message: "Not found." },
      account_not_found: { status: 404, message: "The account does not exist." },
      personality_not_found: { status: 404, message: "The personality does not exist." },
      scope: { status: 403, message: "Outside your scope." },
      human_only: { status: 403, message: "Only the dashboard's owner may do this." },
      invalid_transition: {
        status: 409,
        message: "The post cannot do that in its current state.",
      },
      version_conflict: {
        status: 409,
        message: "The post changed meanwhile; reload and try again.",
      },
      not_deletable: { status: 409, message: "Only a published post can be deleted." },
      needs_reconnect: { status: 409, message: "Reconnect the account on X first." },
      different_x_user: {
        status: 409,
        message: "That X login is a different account from the one being reconnected.",
      },
      already_connected: { status: 409, message: "That X account is already connected." },
      confirmation_required: {
        status: 400,
        message: "Confirm that you checked X and the post is not there.",
      },
      oauth_state: {
        status: 400,
        message: "The connect link expired, was already used, or belongs to another session.",
      },
      oauth_failed: { status: 502, message: "X did not complete the connection." },
      personality_required: { status: 400, message: "Choose a personality for the new account." },
      name_required: { status: 400, message: "A personality needs a name." },
      throttled: { status: 429, message: "Too many failed logins; wait fifteen minutes." },
      wrong_password: { status: 401, message: "Wrong password." },
      daily_cap: { status: 400, message: "The daily cap must be a whole number of at least 1." },
      min_gap: { status: 400, message: "The minimum gap must be zero or more whole minutes." },
      quiet_hours: { status: 400, message: "Quiet hours need two different times." },
      tz: { status: 400, message: "Unknown time zone." },
      grace: { status: 400, message: "The grace must be zero or more whole minutes." },
      no_parts: { status: 400, message: "A post needs at least one part." },
      too_many_parts: { status: 400, message: "A thread has at most 25 parts." },
      link_policy: { status: 400, message: "The account's policy refuses links." },
    });
  });

  it("an unknown code, or a name on Object's prototype, is a plain 400", () => {
    expect(refusalView("part_too_long")).toStrictEqual({
      status: 400,
      message: "Refused: part_too_long.",
    });
    expect(refusalView("constructor")).toStrictEqual({
      status: 400,
      message: "Refused: constructor.",
    });
  });

  it("builds each outcome", () => {
    expect(page({ a: 1 })).toStrictEqual({ kind: "page", view: { a: 1 } });
    expect(redirect("/x")).toStrictEqual({ kind: "redirect", location: "/x" });
    expect(refused("scope")).toStrictEqual({
      kind: "refused",
      status: 403,
      message: "Outside your scope.",
    });
    expect(invalid("Bad.")).toStrictEqual({ kind: "refused", status: 400, message: "Bad." });
  });

  it("a presenter read before the use case presented is a bug", () => {
    const presenter = new Presenter((value: number) => value + 1);
    expect(() => presenter.result()).toThrow("the use case presented nothing");
    presenter.present(T0);
    expect(presenter.result()).toBe(T0 + 1);
  });
});

/** The X port contracts against the in-memory fakes and against the fetch drivers (plan §6). */
import { describe, expect, it } from "vitest";
import { invocationBudget } from "../../src/entities/budget/budget";
import { accountId, xPostId, type XPostId } from "../../src/entities/identity/ids";
import { HOUR, SECOND } from "../../src/entities/time/instant";
import type { XFailure } from "../../src/entities/x/x_failure";
import {
  FakeXMediaUploader,
  FakeXMetrics,
  FakeXPublisher,
  FakeXTimeline,
  FakeXUserMetrics,
  FakeXWorld,
} from "../../src/frameworks/memory/fake_x";
import { ManualClock } from "../../src/frameworks/memory/manual_clock";
import { InvocationBudgetMeter } from "../../src/frameworks/budget/invocation_meter";
import { MemoryAccountRepository } from "../../src/frameworks/memory/memory_repositories";
import type { TransportResult } from "../../src/frameworks/x_http/transport";
import { XApiClient } from "../../src/frameworks/x_http/x_api_client";
import { HttpXMediaUploader } from "../../src/frameworks/x_http/x_media_driver";
import { HttpXMetricsReader } from "../../src/frameworks/x_http/x_metrics_driver";
import { HttpXUserMetricsReader } from "../../src/frameworks/x_http/x_user_metrics_driver";
import { HttpXPublisher } from "../../src/frameworks/x_http/x_publisher_driver";
import { HttpXOwnTimelineReader } from "../../src/frameworks/x_http/x_timeline_driver";
import { AccountXUserDirectory } from "../../src/frameworks/x_http/x_user_directory";
import { ACCOUNT, anAccount, T0 } from "../unit/support/builders";
import { XEmulator } from "./support/x_emulator";
import {
  appWindowHeaders,
  FixedTokens,
  FixtureTransport,
  NO_RESPONSE,
  NOT_SENT,
  PROBLEMS,
  respond,
  userWindowHeaders,
} from "./support/x_fixtures";
import {
  xMediaUploaderContract,
  xMetricsContract,
  xPublisherContract,
  xTimelineContract,
  xUserMetricsContract,
  type Scripted,
  type SeededPost,
} from "./x_ports.contract";

/** The fakes are scripted with the failure itself. */
function fakeFailure(scripted: Scripted): XFailure {
  switch (scripted.kind) {
    case "not_sent":
    case "no_response":
      return { kind: scripted.kind };
    case "rate_limited":
      return {
        kind: "http",
        status: 429,
        detail: "",
        retryAt: scripted.retryAt,
        scope: scripted.scope,
      };
    case "status":
      return { kind: "http", status: scripted.status, detail: "", retryAt: null, scope: "user" };
    case "content_refused":
      return { kind: "content_refused", status: 403, detail: "duplicate content" };
  }
}

/** The drivers are scripted with X's documented responses. */
function wireFailure(scripted: Scripted): TransportResult {
  switch (scripted.kind) {
    case "not_sent":
      return NOT_SENT;
    case "no_response":
      return NO_RESPONSE;
    case "rate_limited": {
      const reset = scripted.retryAt / SECOND;
      const headers = scripted.scope === "app" ? appWindowHeaders(reset) : userWindowHeaders(reset);
      return respond(429, PROBLEMS.rateLimited, headers);
    }
    case "status":
      return respond(
        scripted.status,
        {
          400: PROBLEMS.invalidRequest,
          401: PROBLEMS.unauthorized,
          403: PROBLEMS.unsupportedAuth,
          503: PROBLEMS.serverError,
        }[scripted.status],
      );
    case "content_refused":
      return respond(403, PROBLEMS.duplicate);
  }
}

function fakes(now = T0) {
  const world = new FakeXWorld(new ManualClock(now));
  const script = (operation: keyof FakeXWorld["scripts"]) => (next: Scripted) => {
    world.scripts[operation].push({ kind: "fail", failure: fakeFailure(next) });
  };
  return { world, script };
}

function drivers(now = T0 + HOUR) {
  const clock = new ManualClock(now);
  const emulator = new XEmulator(() => clock.now());
  const transport = new FixtureTransport(emulator.handle);
  const meter = new InvocationBudgetMeter(invocationBudget(now + HOUR));
  const client = new XApiClient(transport, new FixedTokens(), meter);
  const accounts = new MemoryAccountRepository();
  accounts.rows.set(ACCOUNT, anAccount());
  const script = (next: Scripted) => {
    transport.script(wireFailure(next));
  };
  return { clock, emulator, transport, client, accounts, script };
}

const seedEmulator = (emulator: XEmulator, posts: readonly SeededPost[]): XPostId[] =>
  posts.map((post) => {
    const id = emulator.newId();
    emulator.posts.set(id, { id, ...post });
    return xPostId(id);
  });

describe("fake X", () => {
  xPublisherContract(() => {
    const { world, script } = fakes();
    const publisher = new FakeXPublisher(world);
    return {
      publisher,
      script: (next) => {
        script("create")(next);
        script("delete")(next);
      },
    };
  });
  xMediaUploaderContract(() => {
    const { world, script } = fakes();
    return { uploader: new FakeXMediaUploader(world), script: script("upload") };
  });
  xTimelineContract(() => {
    const { world, script } = fakes();
    return {
      reader: new FakeXTimeline(world),
      script: script("timeline"),
      seed: (posts) =>
        Promise.resolve(
          posts.map((post) => {
            const id = xPostId(world.newId("x"));
            world.posts.set(id, { id, account: ACCOUNT, media: [], ...post });
            return id;
          }),
        ),
    };
  });
  xMetricsContract(() => {
    const { world, script } = fakes();
    return {
      reader: new FakeXMetrics(world),
      script: script("metrics"),
      now: T0,
      seed: (ids) => {
        for (const id of ids) {
          world.posts.set(id, {
            id,
            account: ACCOUNT,
            media: [],
            text: "t",
            createdAt: T0,
            inReplyTo: null,
          });
        }
      },
    };
  });
});

describe("fake X: the user's follower counts", () => {
  xUserMetricsContract(() => {
    const { world, script } = fakes();
    const reader = new FakeXUserMetrics(world);
    return {
      reader,
      script: script("users"),
      setFollowers: (count) => reader.followers.set(ACCOUNT, count),
    };
  });
});

describe("fetch drivers against docs.x.com fixtures", () => {
  xPublisherContract(() => {
    const { client, script } = drivers();
    return { publisher: new HttpXPublisher(client), script };
  });
  xMediaUploaderContract(() => {
    const { client, script } = drivers();
    return { uploader: new HttpXMediaUploader(client, () => Promise.resolve()), script };
  });
  xTimelineContract(() => {
    const { client, clock, accounts, emulator, script } = drivers();
    const reader = new HttpXOwnTimelineReader(client, new AccountXUserDirectory(accounts), clock);
    return { reader, script, seed: (posts) => Promise.resolve(seedEmulator(emulator, posts)) };
  });
  xMetricsContract(() => {
    const { client, clock, emulator, script } = drivers();
    return {
      reader: new HttpXMetricsReader(client, clock),
      script,
      now: clock.now(),
      seed: (ids) => {
        for (const id of ids) {
          emulator.posts.set(id, { id, text: "t", createdAt: T0, inReplyTo: null });
        }
      },
    };
  });
});

describe("the user metrics driver (GROKCHAT-15)", () => {
  const userReader = () => {
    const { client, accounts, emulator, transport, script } = drivers();
    return {
      reader: new HttpXUserMetricsReader(client, new AccountXUserDirectory(accounts)),
      emulator,
      transport,
      script,
    };
  };

  xUserMetricsContract(() => {
    const { reader, emulator, script } = userReader();
    return { reader, script, setFollowers: (count) => (emulator.followers = count) };
  });

  it("asks for the account's own user with public_metrics, and reads every count", async () => {
    const { reader, transport } = userReader();
    expect(await reader.read(ACCOUNT)).toStrictEqual({
      ok: true,
      value: { followers: 1_234, following: 56, posts: 789, listed: 3 },
    });
    const [request] = transport.seen;
    expect(request?.method).toBe("GET");
    expect(request?.url.pathname).toBe("/2/users/x-user-1");
    expect(request?.url.searchParams.get("user.fields")).toBe("public_metrics");
  });

  it("sends nothing for an account with no X user", async () => {
    const { reader, transport } = userReader();
    expect(await reader.read(accountId("nobody"))).toStrictEqual({
      ok: false,
      failure: { kind: "not_sent" },
    });
    expect(transport.seen).toStrictEqual([]);
  });

  it("a 2xx with no follower count reached X: no_response; missing other counts read as 0", async () => {
    const { reader, transport } = userReader();
    transport.script(respond(200, { data: { id: "x-user-1" } }));
    expect(await reader.read(ACCOUNT)).toStrictEqual({
      ok: false,
      failure: { kind: "no_response" },
    });
    transport.script(respond(200, { data: { public_metrics: { followers_count: 7 } } }));
    expect(await reader.read(ACCOUNT)).toStrictEqual({
      ok: true,
      value: { followers: 7, following: 0, posts: 0, listed: 0 },
    });
  });
});

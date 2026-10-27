/** The X port contracts against the in-memory fakes and against the fetch drivers (plan §6). */
import { describe } from "vitest";
import { xPostId, type XPostId } from "../../src/entities/identity/ids";
import { HOUR, SECOND } from "../../src/entities/time/instant";
import type { XFailure } from "../../src/entities/x/x_failure";
import {
  FakeXMediaUploader,
  FakeXMetrics,
  FakeXPublisher,
  FakeXTimeline,
  FakeXWorld,
} from "../../src/frameworks/memory/fake_x";
import { ManualClock } from "../../src/frameworks/memory/manual_clock";
import { MemoryAccountRepository } from "../../src/frameworks/memory/memory_repositories";
import type { TransportResult } from "../../src/frameworks/x_http/transport";
import { XApiClient } from "../../src/frameworks/x_http/x_api_client";
import { HttpXMediaUploader } from "../../src/frameworks/x_http/x_media_driver";
import { HttpXMetricsReader } from "../../src/frameworks/x_http/x_metrics_driver";
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
  const client = new XApiClient(transport, new FixedTokens(), clock);
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

/**
 * The X drivers spend the invocation's `Budget` (plan §3.2, A4, U16) and ask for tokens against
 * its real deadline (N1): every request through `MeteredTransport` costs one of the 50 external
 * subrequests, and a run whose next part no longer fits yields instead of hitting workerd's
 * "too many subrequests".
 */
import { describe, expect, it } from "vitest";
import {
  invocationBudget,
  partCost,
  TOKEN_REFRESH_MILLIS,
  type Budget,
} from "../../src/entities/budget/budget";
import { postId, xPostId, type StagedMediaId } from "../../src/entities/identity/ids";
import { HOUR, MINUTE, SECOND } from "../../src/entities/time/instant";
import { MemoryBudgetMeter } from "../../src/frameworks/memory/memory_budget";
import { MemoryLocks } from "../../src/frameworks/durable_objects/object_locks";
import { MemoryTokenStore } from "../../src/frameworks/memory/memory_tokens";
import { XTokenEndpoint } from "../../src/frameworks/x_auth/token_endpoint";
import { HttpXTokenRefresher } from "../../src/frameworks/x_auth/x_token_refresher_driver";
import { MeteredTransport } from "../../src/frameworks/x_http/metered_transport";
import { XApiClient } from "../../src/frameworks/x_http/x_api_client";
import { CHUNK_BYTES, HttpXMediaUploader } from "../../src/frameworks/x_http/x_media_driver";
import { HttpXMetricsReader } from "../../src/frameworks/x_http/x_metrics_driver";
import { HttpXPublisher } from "../../src/frameworks/x_http/x_publisher_driver";
import { MediaStager } from "../../src/use_cases/run_services/media_stager";
import { PartSender } from "../../src/use_cases/run_services/part_sender";
import { PublishPost } from "../../src/use_cases/run_services/publish_post";
import { RefreshingTokenProvider } from "../../src/use_cases/run_services/refreshing_token_provider";
import { ACCOUNT, aPolicy, aPost, part, T0 } from "../unit/support/builders";
import { makeWorld } from "../unit/support/world";
import { XEmulator } from "./support/x_emulator";
import {
  FixedTokens,
  FixtureTransport,
  NO_RESPONSE,
  NOT_SENT,
  respond,
  tokenBody,
} from "./support/x_fixtures";

const CONFIG = { clientId: "id", clientSecret: "secret", redirectUri: "https://g.example/cb" };
const noWait = (): Promise<void> => Promise.resolve();
const external = (budget: Budget): number => budget.externalSubrequests;
const meterUntil = (deadline: number): MemoryBudgetMeter =>
  new MemoryBudgetMeter(invocationBudget(deadline));

describe("MeteredTransport (U16)", () => {
  it("every request is one external subrequest, whatever became of it", async () => {
    const meter = meterUntil(T0 + HOUR);
    const inner = new FixtureTransport().script(respond(200, {}), NOT_SENT, NO_RESPONSE);
    const transport = new MeteredTransport(inner, meter);
    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push((await transport.send(new Request("https://api.x.com/2/a"), SECOND)).kind);
    }
    expect(results).toStrictEqual(["response", "not_sent", "no_response"]);
    expect(inner.seen.map((seen) => seen.timeout)).toStrictEqual([SECOND, SECOND, SECOND]);
    expect(meter.remaining()).toStrictEqual({
      deadline: T0 + HOUR,
      cloudflareCalls: 1_000,
      externalSubrequests: 47,
    });
  });

  it("a chunked GIF spends one per call: INIT, each APPEND, FINALIZE and each STATUS", async () => {
    const meter = meterUntil(T0 + HOUR);
    const inner = new FixtureTransport().script(
      respond(202, { data: { id: "9", expires_after_secs: 86400 } }),
      { kind: "response", response: new Response(null, { status: 204 }) },
      { kind: "response", response: new Response(null, { status: 204 }) },
      respond(200, {
        data: { id: "9", processing_info: { state: "pending", check_after_secs: 1 } },
      }),
      respond(200, { data: { id: "9", processing_info: { state: "succeeded" } } }),
    );
    const client = new XApiClient(new MeteredTransport(inner, meter), new FixedTokens(), meter);
    const uploader = new HttpXMediaUploader(client, noWait);
    const result = await uploader.upload(ACCOUNT, new Uint8Array(CHUNK_BYTES + 1), "GIF");
    expect(result).toStrictEqual({ ok: true, value: "9" });
    expect(inner.seen).toHaveLength(5);
    expect(external(meter.remaining())).toBe(50 - 5);
    inner.script(respond(200, { data: { id: "10" } }));
    await uploader.upload(ACCOUNT, new Uint8Array(3), "PHOTO");
    expect(external(meter.remaining())).toBe(50 - 6);
  });
});

describe("a read's token refresh, against the invocation's deadline (N1, A2)", () => {
  async function setup(deadline: (now: number) => number) {
    const now = T0 + 2 * HOUR - 5 * MINUTE;
    const world = makeWorld();
    world.clock.set(now);
    const meter = meterUntil(deadline(now));
    const tokenWire = new FixtureTransport().script(respond(200, tokenBody(2)));
    const xWire = new FixtureTransport(new XEmulator(() => world.clock.now()).handle);
    const store = new MemoryTokenStore();
    await store.commitRotated(ACCOUNT, {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      accessExpiresAt: T0 + 2 * HOUR,
    });
    const endpoint = new XTokenEndpoint(new MeteredTransport(tokenWire, meter), CONFIG);
    const provider = new RefreshingTokenProvider(
      store,
      new HttpXTokenRefresher(endpoint, world.clock),
      new MemoryLocks(world.clock, world.clock),
      world.clock,
    );
    const client = new XApiClient(new MeteredTransport(xWire, meter), provider, meter);
    const reader = new HttpXMetricsReader(client, world.clock);
    return { meter, tokenWire, xWire, reader };
  }

  it("a token inside the margin and too little time left: no refresh, no read", async () => {
    const { meter, tokenWire, xWire, reader } = await setup((now) => now + SECOND);
    expect(await reader.read(ACCOUNT, [xPostId("1")])).toStrictEqual({
      ok: false,
      failure: { kind: "not_sent" },
    });
    expect(tokenWire.seen).toHaveLength(0);
    expect(xWire.seen).toHaveLength(0);
    expect(external(meter.remaining())).toBe(50);
  });

  it("with the refresh's whole minute left: one refresh and the read, two subrequests", async () => {
    const { meter, tokenWire, xWire, reader } = await setup((now) => now + TOKEN_REFRESH_MILLIS);
    expect((await reader.read(ACCOUNT, [xPostId("1")])).ok).toBe(true);
    expect(tokenWire.seen).toHaveLength(1);
    expect(xWire.seen[0]?.headers.get("authorization")).toBe("Bearer access-2");
    expect(external(meter.remaining())).toBe(50 - 2);
  });
});

describe("a publish run on the fetch drivers yields when the subrequests run out (A4, U16)", () => {
  it("a thread of GIF parts stops once the next part's worst case no longer fits", async () => {
    const world = makeWorld();
    await world.seedAccount({ policy: aPolicy({ minGap: 0 }) });
    const parts = [];
    for (let index = 0; index < 12; index += 1) {
      const media: StagedMediaId[] = [(await world.stage(ACCOUNT, "GIF")).id];
      parts.push(part(`part ${String(index)}`, undefined, media));
    }
    world.table.rows.set(postId("p"), aPost({ id: postId("p"), parts }));

    const meter = meterUntil(T0 + HOUR);
    const wire = new FixtureTransport(new XEmulator(() => world.clock.now()).handle);
    const client = new XApiClient(new MeteredTransport(wire, meter), world.tokens, meter);
    const { reader, accounts, locks, clock, recovery, steps, recorder, media, blobs, usage } =
      world;
    const uploader = new HttpXMediaUploader(client, noWait);
    const stager = new MediaStager({ media, blobs, usage, uploader, recorder });
    const publisher = new HttpXPublisher(client);
    const sender = new PartSender({
      reader,
      accounts,
      tokens: world.tokens,
      publisher,
      stager,
      recorder,
      steps,
      clock,
    });
    const run = new PublishPost({ reader, accounts, locks, clock, recovery, steps, sender });

    const summary = await run.publishNow(ACCOUNT, postId("p"), meter);

    // Each part sends INIT, APPEND, FINALIZE and the create; a GIF part reserves 12.
    expect(partCost(["GIF"]).externalSubrequests).toBe(12);
    expect(summary.sent).toBe(10);
    expect(wire.seen).toHaveLength(40);
    expect(external(meter.remaining())).toBe(10);
    const states = world.table.rows.get(postId("p"))?.parts.map((p) => p.state.kind);
    expect(states).toStrictEqual([...Array<string>(10).fill("SENT"), "PENDING", "PENDING"]);
  });
});

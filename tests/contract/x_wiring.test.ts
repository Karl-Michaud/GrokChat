/**
 * The fetch drivers as the account object wires them (plan §3.5, A4): per invocation, around its
 * meter, with the X app's credentials read from the Worker's env (plan §3.6).
 */
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { INVOCATION_LIMITS, invocationBudget } from "../../src/entities/budget/budget";
import { accountId, xPostId } from "../../src/entities/identity/ids";
import { MINUTE } from "../../src/entities/time/instant";
import { HttpXWiring } from "../../src/frameworks/durable_objects/http_x_wiring";
import { ManualClock } from "../../src/frameworks/memory/manual_clock";
import { InvocationBudgetMeter } from "../../src/frameworks/budget/invocation_meter";
import { MemoryAuditLog, MemoryCostLedger } from "../../src/frameworks/memory/memory_records";
import { MemoryAccountRepository } from "../../src/frameworks/memory/memory_repositories";
import { basicAuth } from "../../src/frameworks/x_auth/token_endpoint";
import { TOKEN_URL, xClientCredentials } from "../../src/frameworks/x_auth/x_oauth_config";
import { AccountXUserDirectory } from "../../src/frameworks/x_http/x_user_directory";
import { XCallRecorder } from "../../src/use_cases/run_services/x_call_recorder";
import { productionX } from "../../src/frameworks/composition/account_graph";
import { anAccount, T0 } from "../unit/support/builders";
import { created, FixedTokens, FixtureTransport, respond, tokenBody } from "./support/x_fixtures";

const ACCOUNT = accountId("acc-wiring");

describe("HttpXWiring: the fetch drivers, around one invocation's meter (plan §3.5, A4)", () => {
  function setup() {
    const clock = new ManualClock(T0);
    const transport = new FixtureTransport();
    const audit = new MemoryAuditLog();
    const costs = new MemoryCostLedger();
    const accounts = new MemoryAccountRepository();
    const deferred: Promise<unknown>[] = [];
    const wiring = new HttpXWiring({
      transport,
      credentials: { clientId: "client id", clientSecret: "s3cr3t" },
      recorder: new XCallRecorder(audit, costs),
      users: new AccountXUserDirectory(accounts),
      clock,
      defer: (work) => deferred.push(work),
      wait: () => Promise.resolve(),
    });
    const meter = new InvocationBudgetMeter(invocationBudget(T0 + 10 * MINUTE));
    return { clock, transport, audit, costs, accounts, deferred, wiring, meter };
  }

  it("the refresher calls X's token endpoint with the app's credentials, spends one subrequest, and records the call", async () => {
    const { transport, audit, costs, deferred, wiring, meter } = setup();
    transport.script(respond(200, tokenBody(2)));
    const result = await wiring.refresher(ACCOUNT, meter).refresh("refresh-1");
    expect(result).toStrictEqual({
      kind: "rotated",
      tokens: {
        accessToken: "access-2",
        refreshToken: "refresh-2",
        accessExpiresAt: T0 + 7_200_000,
      },
    });
    const seen = transport.seen[0];
    expect(seen?.url.href).toBe(TOKEN_URL);
    expect(seen?.headers.get("authorization")).toBe(
      basicAuth({ clientId: "client id", clientSecret: "s3cr3t" }),
    );
    expect(meter.remaining().externalSubrequests).toBe(INVOCATION_LIMITS.externalSubrequests - 1);
    await Promise.all(deferred);
    expect(
      audit.events.map((event) => [event.action, event.accountId, event.detail]),
    ).toStrictEqual([["x.oauth", ACCOUNT, "refresh rotated"]]);
    expect(costs.entries).toHaveLength(1);
  });

  it("the API ports share one metered client that asks the given provider for tokens", async () => {
    const { transport, accounts, wiring, meter } = setup();
    await accounts.save(anAccount({ id: ACCOUNT }));
    const tokens = new FixedTokens();
    const x = wiring.calls(meter, tokens);
    transport.script(
      created("1850000000000000001", "hello"),
      respond(200, { data: [], meta: { result_count: 0 } }),
      respond(200, { data: [] }),
      respond(200, { data: { id: "77", media_key: "3_77" } }),
    );
    expect(await x.publisher.create(ACCOUNT, "hello", [], null)).toStrictEqual({
      ok: true,
      value: xPostId("1850000000000000001"),
    });
    expect((await x.timeline.recent(ACCOUNT, T0 - MINUTE, 5)).ok).toBe(true);
    expect((await x.metrics.read(ACCOUNT, [xPostId("1")])).ok).toBe(true);
    expect((await x.uploader.upload(ACCOUNT, new Uint8Array([1, 2]), "PHOTO")).ok).toBe(true);
    expect(transport.seen.map((seen) => `${seen.method} ${seen.url.pathname}`)).toStrictEqual([
      "POST /2/tweets",
      `GET /2/users/${anAccount({ id: ACCOUNT }).xUserId}/tweets`,
      "GET /2/tweets",
      "POST /2/media/upload",
    ]);
    expect(
      transport.seen.every((seen) => seen.headers.get("authorization") === "Bearer access-1"),
    ).toBe(true);
    expect(tokens.deadlines).toStrictEqual(Array(4).fill(T0 + 10 * MINUTE));
    expect(meter.remaining().externalSubrequests).toBe(INVOCATION_LIMITS.externalSubrequests - 4);
  });

  it("two invocations' meters stay apart", async () => {
    const { transport, wiring } = setup();
    const first = new InvocationBudgetMeter(invocationBudget(T0 + MINUTE));
    const second = new InvocationBudgetMeter(invocationBudget(T0 + MINUTE));
    transport.script(created("1", "a"), created("2", "b"), created("3", "c"));
    await wiring.calls(first, new FixedTokens()).publisher.create(ACCOUNT, "a", [], null);
    const other = wiring.calls(second, new FixedTokens()).publisher;
    await other.create(ACCOUNT, "b", [], null);
    await other.create(ACCOUNT, "c", [], null);
    expect(first.remaining().externalSubrequests).toBe(49);
    expect(second.remaining().externalSubrequests).toBe(48);
  });
});

describe("the X app's credentials, read at the boundary (plan §3.6)", () => {
  it("both secrets are required, and a missing one is named, never shown", () => {
    expect(xClientCredentials({ X_CLIENT_ID: "id", X_CLIENT_SECRET: "secret" })).toStrictEqual({
      clientId: "id",
      clientSecret: "secret",
    });
    expect(() => xClientCredentials({})).toThrow(
      "missing configuration: X_CLIENT_ID, X_CLIENT_SECRET",
    );
    expect(() => xClientCredentials({ X_CLIENT_ID: "id", X_CLIENT_SECRET: "" })).toThrow(
      /^missing configuration: X_CLIENT_SECRET$/,
    );
    expect(() => xClientCredentials({ X_CLIENT_SECRET: "secret" })).toThrow(
      /^missing configuration: X_CLIENT_ID$/,
    );
  });

  it("the production object's X wiring is built from the Worker's env, and fails without the secrets", () => {
    const ctx = { waitUntil: () => undefined } as unknown as DurableObjectState;
    expect(productionX(ctx, env)).toBeInstanceOf(HttpXWiring);
    expect(() => productionX(ctx, { ...env, X_CLIENT_ID: undefined } as never)).toThrow(
      "missing configuration: X_CLIENT_ID",
    );
  });
});

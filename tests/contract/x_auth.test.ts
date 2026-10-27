/** X's OAuth 2.0 drivers: PKCE connect, the refresh call, the token provider on the wire (U1, U14). */
import { describe, expect, it } from "vitest";
import { xUserId } from "../../src/entities/identity/ids";
import { HOUR, MINUTE, SECOND } from "../../src/entities/time/instant";
import { ManualClock } from "../../src/frameworks/memory/manual_clock";
import { MemoryLocks } from "../../src/frameworks/memory/memory_locks";
import { MemoryAuditLog, MemoryCostLedger } from "../../src/frameworks/memory/memory_records";
import { MemoryTokenStore } from "../../src/frameworks/memory/memory_tokens";
import {
  AuditedXAccountConnector,
  RecordedXTokenRefresher,
} from "../../src/frameworks/x_auth/recorded_oauth";
import {
  basicAuth,
  TOKEN_TIMEOUT,
  XTokenEndpoint,
} from "../../src/frameworks/x_auth/token_endpoint";
import {
  base64Url,
  s256,
  VERIFIER_BYTES,
  WebCryptoPkce,
} from "../../src/frameworks/x_auth/webcrypto_pkce";
import { HttpXAccountConnector } from "../../src/frameworks/x_auth/x_account_connector_driver";
import {
  AUTHORIZE_URL,
  SCOPES,
  TOKEN_URL,
  xOAuthConfig,
  type XOAuthConfig,
} from "../../src/frameworks/x_auth/x_oauth_config";
import { HttpXTokenRefresher } from "../../src/frameworks/x_auth/x_token_refresher_driver";
import type { XAccountConnector } from "../../src/use_cases/ports/x_account_connector";
import {
  REFRESH_MARGIN,
  RefreshingTokenProvider,
} from "../../src/use_cases/run_services/refreshing_token_provider";
import { XCallRecorder } from "../../src/use_cases/run_services/x_call_recorder";
import { ACCOUNT, T0 } from "../unit/support/builders";
import {
  FixtureTransport,
  INVALID_TOKEN,
  NO_RESPONSE,
  NOT_SENT,
  PROBLEMS,
  respond,
  tokenBody,
} from "./support/x_fixtures";

const CONFIG: XOAuthConfig = {
  clientId: "client id",
  clientSecret: "s3cr3t",
  redirectUri: "https://grokchat.example.workers.dev/oauth/x/callback",
};

function setup() {
  const clock = new ManualClock(T0);
  const transport = new FixtureTransport();
  const endpoint = new XTokenEndpoint(transport, CONFIG);
  return { clock, transport, endpoint };
}

describe("the OAuth config", () => {
  it("is parsed from the secrets and the public origin", () => {
    expect(
      xOAuthConfig({
        X_CLIENT_ID: "id",
        X_CLIENT_SECRET: "secret",
        GROKCHAT_PUBLIC_ORIGIN: "https://grokchat.example.workers.dev",
      }),
    ).toStrictEqual({
      clientId: "id",
      clientSecret: "secret",
      redirectUri: "https://grokchat.example.workers.dev/oauth/x/callback",
    });
  });

  it("fails by name, never by value, on a missing secret or a bad origin", () => {
    expect(() => xOAuthConfig({ X_CLIENT_ID: "id", X_CLIENT_SECRET: "" })).toThrow(
      "missing configuration: X_CLIENT_SECRET, GROKCHAT_PUBLIC_ORIGIN",
    );
    for (const origin of ["http://grokchat.dev", "https://grokchat.dev/path"]) {
      expect(() =>
        xOAuthConfig({ X_CLIENT_ID: "a", X_CLIENT_SECRET: "b", GROKCHAT_PUBLIC_ORIGIN: origin }),
      ).toThrow("GROKCHAT_PUBLIC_ORIGIN must be an https origin, without a path");
    }
  });
});

describe("the token endpoint", () => {
  it("posts the form as a confidential client, with HTTP Basic and a minute's timeout", async () => {
    const { transport, endpoint } = setup();
    transport.script(respond(200, tokenBody(1)));
    expect(await endpoint.request({ grant_type: "refresh_token" }, T0)).toStrictEqual({
      kind: "tokens",
      tokens: {
        accessToken: "access-1",
        refreshToken: "refresh-1",
        accessExpiresAt: T0 + 2 * HOUR,
      },
    });
    const seen = transport.seen[0];
    expect(seen?.url.toString()).toBe(TOKEN_URL);
    expect(seen?.method).toBe("POST");
    expect(seen?.headers.get("authorization")).toBe(basicAuth(CONFIG));
    expect(basicAuth(CONFIG)).toBe(`Basic ${btoa("client%20id:s3cr3t")}`);
    expect(seen?.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(seen?.body).toBe("grant_type=refresh_token&client_id=client+id");
    expect(seen?.timeout).toBe(TOKEN_TIMEOUT);
    expect(TOKEN_TIMEOUT).toBeGreaterThanOrEqual(60 * SECOND);
  });

  it("only a request that never left is not_sent; everything else failed", async () => {
    const { transport, endpoint } = setup();
    const broken = new ReadableStream({
      pull(controller) {
        controller.error(new Error("reset"));
      },
    });
    transport.script(
      NOT_SENT,
      NO_RESPONSE,
      INVALID_TOKEN,
      respond(200, { ...tokenBody(2), refresh_token: undefined }),
      respond(200, { ...tokenBody(2), expires_in: "7200" }),
      { kind: "response", response: new Response(broken, { status: 200 }) },
      respond(503, PROBLEMS.serverError),
    );
    const results = [];
    for (let i = 0; i < 7; i += 1) {
      results.push(await endpoint.request({}, T0));
    }
    expect(results).toStrictEqual([
      { kind: "not_sent" },
      { kind: "failed", status: null },
      { kind: "failed", status: 400 },
      { kind: "failed", status: 200 },
      { kind: "failed", status: 200 },
      { kind: "failed", status: 200 },
      { kind: "failed", status: 503 },
    ]);
  });
});

describe("HttpXTokenRefresher (U1, U14)", () => {
  it("grant_type=refresh_token; rotated, not sent, or failed", async () => {
    const { transport, endpoint, clock } = setup();
    const refresher = new HttpXTokenRefresher(endpoint, clock);
    transport.script(respond(200, tokenBody(3)), NOT_SENT, INVALID_TOKEN, NO_RESPONSE);
    expect(await refresher.refresh("refresh-2")).toStrictEqual({
      kind: "rotated",
      tokens: {
        accessToken: "access-3",
        refreshToken: "refresh-3",
        accessExpiresAt: T0 + 2 * HOUR,
      },
    });
    expect(new URLSearchParams(transport.seen[0]?.body).get("refresh_token")).toBe("refresh-2");
    expect(await refresher.refresh("r")).toStrictEqual({ kind: "not_sent" });
    expect(await refresher.refresh("r")).toStrictEqual({ kind: "failed" });
    expect(await refresher.refresh("r")).toStrictEqual({ kind: "failed" });
  });

  it("drives the token provider: proactive refresh, rotation persisted, a lost token is final", async () => {
    const { transport, endpoint, clock } = setup();
    const store = new MemoryTokenStore();
    const provider = new RefreshingTokenProvider(
      store,
      new HttpXTokenRefresher(endpoint, clock),
      new MemoryLocks(clock),
      clock,
    );
    const deadline = T0 + HOUR;
    await store.commitRotated(ACCOUNT, {
      accessToken: "access-0",
      refreshToken: "refresh-0",
      accessExpiresAt: T0 + REFRESH_MARGIN,
    });
    expect(await provider.accessToken(ACCOUNT, deadline)).toStrictEqual({
      kind: "token",
      accessToken: "access-0",
    });
    expect(transport.seen).toHaveLength(0);
    clock.advance(MINUTE);
    transport.script(respond(200, tokenBody(1)));
    expect(await provider.accessToken(ACCOUNT, deadline)).toStrictEqual({
      kind: "token",
      accessToken: "access-1",
    });
    expect((await store.load(ACCOUNT))?.tokens.refreshToken).toBe("refresh-1");
    clock.advance(2 * HOUR);
    transport.script(NOT_SENT);
    expect(await provider.accessToken(ACCOUNT, deadline + 2 * HOUR)).toStrictEqual({
      kind: "unavailable",
    });
    transport.script(INVALID_TOKEN);
    expect(await provider.accessToken(ACCOUNT, deadline + 2 * HOUR)).toStrictEqual({
      kind: "needs_reconnect",
    });
    expect(await provider.accessToken(ACCOUNT, deadline + 2 * HOUR)).toStrictEqual({
      kind: "needs_reconnect",
    });
    expect(transport.seen).toHaveLength(3);
  });
});

describe("HttpXAccountConnector (U1)", () => {
  const me = respond(200, { data: { id: "1449", name: "Muse", username: "musechat_one" } });

  it("the authorize URL: code flow, PKCE S256, the five scopes, state and callback", () => {
    const { endpoint, transport, clock } = setup();
    const url = new URL(
      new HttpXAccountConnector(CONFIG, endpoint, transport, clock).authorizeUrl("st", "ch"),
    );
    expect(`${url.origin}${url.pathname}`).toBe(AUTHORIZE_URL);
    expect(Object.fromEntries(url.searchParams)).toStrictEqual({
      response_type: "code",
      client_id: "client id",
      redirect_uri: CONFIG.redirectUri,
      scope: "tweet.read tweet.write users.read media.write offline.access",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
    });
    expect(SCOPES).toHaveLength(5);
  });

  it("exchanges the code with the verifier, then reads who connected", async () => {
    const { endpoint, transport, clock } = setup();
    transport.script(respond(200, tokenBody(1)), me);
    const connector = new HttpXAccountConnector(CONFIG, endpoint, transport, clock);
    expect(await connector.complete("the-code", "the-verifier")).toStrictEqual({
      xUserId: xUserId("1449"),
      handle: "musechat_one",
      tokens: {
        accessToken: "access-1",
        refreshToken: "refresh-1",
        accessExpiresAt: T0 + 2 * HOUR,
      },
    });
    expect(Object.fromEntries(new URLSearchParams(transport.seen[0]?.body))).toStrictEqual({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: CONFIG.redirectUri,
      code_verifier: "the-verifier",
      client_id: "client id",
    });
    expect(transport.seen[1]?.url.toString()).toBe("https://api.x.com/2/users/me");
    expect(transport.seen[1]?.headers.get("authorization")).toBe("Bearer access-1");
  });

  it("any failure is null: the owner connects again", async () => {
    const { endpoint, transport, clock } = setup();
    const connector = new HttpXAccountConnector(CONFIG, endpoint, transport, clock);
    const broken = new ReadableStream({
      pull(controller) {
        controller.error(new Error("reset"));
      },
    });
    const ok = () => respond(200, tokenBody(1));
    transport.script(
      INVALID_TOKEN,
      ok(),
      NO_RESPONSE,
      ok(),
      respond(401, PROBLEMS.unauthorized),
      ok(),
      respond(200, { data: { id: "1" } }),
      ok(),
      { kind: "response", response: new Response(broken, { status: 200 }) },
    );
    for (let i = 0; i < 5; i += 1) {
      expect(await connector.complete("c", "v")).toBeNull();
    }
  });
});

describe("WebCryptoPkce (RFC 7636)", () => {
  it("S256 of the RFC's example verifier is the RFC's challenge", async () => {
    expect(await s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
    expect(base64Url(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe("-__-");
  });

  it("a fresh 43-character verifier each time, with its challenge", async () => {
    const pkce = new WebCryptoPkce();
    const [a, b] = [await pkce.create(), await pkce.create()];
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).toBe(await s256(a.verifier));
    expect(VERIFIER_BYTES).toBe(32);
  });
});

describe("cost and audit for the OAuth calls (I5)", () => {
  it("a refresh records $0 oauth and an audit line after handing back the result", async () => {
    const { endpoint, transport, clock } = setup();
    const audit = new MemoryAuditLog();
    const costs = new MemoryCostLedger();
    const deferred: Promise<unknown>[] = [];
    const refresher = new RecordedXTokenRefresher(
      new HttpXTokenRefresher(endpoint, clock),
      new XCallRecorder(audit, costs),
      ACCOUNT,
      clock,
      (work) => deferred.push(work),
    );
    transport.script(respond(200, tokenBody(1)), INVALID_TOKEN);
    expect((await refresher.refresh("refresh-0")).kind).toBe("rotated");
    expect((await refresher.refresh("refresh-0")).kind).toBe("failed");
    await Promise.all(deferred);
    const lines = await audit.list({});
    expect(lines.map((line) => [line.action, line.accountId, line.detail])).toStrictEqual([
      ["x.oauth", ACCOUNT, "refresh failed"],
      ["x.oauth", ACCOUNT, "refresh rotated"],
    ]);
    expect(JSON.stringify(lines)).not.toContain("refresh-0");
    expect(await costs.totals({ from: T0, to: T0 + 1 }, ACCOUNT)).toStrictEqual({
      micros: 0,
      calls: 2,
      unknownPriced: 0,
    });
  });

  it("a failing record never fails the refresh", async () => {
    const { endpoint, transport, clock } = setup();
    const failingAudit = new MemoryAuditLog();
    failingAudit.append = () => Promise.reject(new Error("D1 down"));
    const deferred: Promise<unknown>[] = [];
    const refresher = new RecordedXTokenRefresher(
      new HttpXTokenRefresher(endpoint, clock),
      new XCallRecorder(failingAudit, new MemoryCostLedger()),
      ACCOUNT,
      clock,
      (work) => deferred.push(work),
    );
    transport.script(respond(200, tokenBody(1)));
    expect((await refresher.refresh("r")).kind).toBe("rotated");
    expect(await Promise.all(deferred)).toStrictEqual([undefined]);
  });

  it("the code exchange is audited with no account, success or not", async () => {
    const clock = new ManualClock(T0);
    const audit = new MemoryAuditLog();
    const user = {
      xUserId: xUserId("1449"),
      handle: "muse",
      tokens: { accessToken: "a", refreshToken: "r", accessExpiresAt: T0 },
    };
    const inner: XAccountConnector = {
      authorizeUrl: (state, challenge) => `u?${state}&${challenge}`,
      complete: (code) => Promise.resolve(code === "good" ? user : null),
    };
    const connector = new AuditedXAccountConnector(inner, audit, clock);
    expect(connector.authorizeUrl("s", "c")).toBe("u?s&c");
    expect(await connector.complete("good", "v")).toBe(user);
    expect(await connector.complete("bad", "v")).toBeNull();
    const lines = await audit.list({});
    expect(lines.map((line) => [line.action, line.accountId, line.detail])).toStrictEqual([
      ["x.oauth", null, "connect failed"],
      ["x.oauth", null, "connected @muse (1449)"],
    ]);
  });
});

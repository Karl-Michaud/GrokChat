/** The X HTTP plumbing: the transport, X's JSON and errors, and the authenticated client. */
import { describe, expect, it } from "vitest";
import { SECOND } from "../../src/entities/time/instant";
import { count, field, list, readJson, text } from "../../src/frameworks/x_http/json_fields";
import { classifyFetchError, FetchTransport } from "../../src/frameworks/x_http/transport";
import { X_CALL_TIMEOUT } from "../../src/frameworks/x_http/x_api_client";
import {
  DETAIL_LIMIT,
  errorDetail,
  failureFor,
  isContentForbidden,
  rateLimit,
} from "../../src/frameworks/x_http/x_errors";
import { ACCOUNT, T0 } from "../unit/support/builders";
import {
  appWindowHeaders,
  clientSetup as setup,
  INVOCATION,
  NO_RESPONSE,
  PROBLEMS,
  respond,
  userDayHeaders,
  userWindowHeaders,
} from "./support/x_fixtures";

const named = (name: string, message = "") => Object.assign(new Error(message), { name });

describe("the transport", () => {
  it("a timeout or abort is after the send; a connect, DNS, TLS or subrequest error before", () => {
    expect(classifyFetchError(named("TimeoutError"))).toStrictEqual({
      kind: "no_response",
      reason: "timeout",
    });
    expect(classifyFetchError(named("AbortError")).kind).toBe("no_response");
    for (const message of [
      "connect ECONNREFUSED 1.2.3.4:443",
      "getaddrinfo ENOTFOUND api.x.com",
      "TLS handshake failed",
      "Too many subrequests.",
    ]) {
      expect(classifyFetchError(new TypeError(message))).toStrictEqual({
        kind: "not_sent",
        reason: message,
      });
    }
    const wrapped = new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });
    expect(classifyFetchError(wrapped).kind).toBe("not_sent");
    expect(classifyFetchError(new TypeError("Network connection lost."))).toStrictEqual({
      kind: "no_response",
      reason: "Network connection lost.",
    });
    expect(classifyFetchError("boom")).toStrictEqual({ kind: "no_response", reason: "boom" });
  });

  it("fetches without following redirects, with a timeout signal, and maps a rejection", async () => {
    const calls: RequestInit[] = [];
    const ok = new FetchTransport((_input, init) => {
      calls.push(init ?? {});
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    const sent = await ok.send(new Request("https://api.x.com/2/x"), 1_000);
    expect(sent.kind).toBe("response");
    expect(calls[0]?.redirect).toBe("manual");
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    const failing = new FetchTransport(() => Promise.reject(new TypeError("connect refused")));
    expect((await failing.send(new Request("https://api.x.com/"), 1)).kind).toBe("not_sent");
  });

  it("workerd reports a refused connection like a lost one, so it counts as possibly sent", async () => {
    // Measured here: `fetch` to a closed local port rejects with "Network connection lost.", the
    // same message as a connection dropped mid-request. A create must never be re-sent on a guess.
    expect(
      await new FetchTransport().send(new Request("http://127.0.0.1:1/"), 2_000),
    ).toStrictEqual({ kind: "no_response", reason: "Network connection lost." });
  });
});

describe("reading X's JSON", () => {
  it("returns null for anything not of the expected shape", async () => {
    expect(field(null, "a")).toBeNull();
    expect(field("s", "a")).toBeNull();
    expect(field({ a: 1 }, "b")).toBeNull();
    expect(field([7], 0)).toBe(7);
    expect(text(1)).toBeNull();
    expect(count(Number.NaN)).toBeNull();
    expect(count("1")).toBeNull();
    expect(count(2)).toBe(2);
    expect(list({})).toStrictEqual([]);
    expect(await readJson(new Response(""))).toBeNull();
    expect(await readJson(new Response("not json"))).toBeNull();
    expect(await readJson(new Response('{"a":1}'))).toStrictEqual({ a: 1 });
  });
});

describe("X's errors", () => {
  it("the detail is the problem's title and detail, or errors[0], redacted and cut", () => {
    expect(errorDetail(PROBLEMS.duplicate)).toBe(
      "Forbidden: You are not allowed to create a Tweet with duplicate content.",
    );
    expect(errorDetail(PROBLEMS.rateLimited)).toBe("Rate limit exceeded");
    expect(errorDetail({ errors: [{ detail: "d" }] })).toBe("d");
    expect(errorDetail({ error: "invalid_request", error_description: "bad" })).toBe("bad");
    expect(errorDetail(null)).toBe("no detail");
    expect(errorDetail({ detail: "echo Bearer abc.def" })).toBe("echo Bearer [redacted]");
    expect(errorDetail({ detail: "x".repeat(1_000) })).toHaveLength(DETAIL_LIMIT);
  });

  it("a 403 is a content refusal only when X says the content was refused", () => {
    expect(isContentForbidden(PROBLEMS.duplicate)).toBe(true);
    expect(isContentForbidden(PROBLEMS.videoTooLong)).toBe(true);
    expect(isContentForbidden({ detail: "You are not permitted to perform this action." })).toBe(
      true,
    );
    const replyRefused =
      "Reply to this conversation is not allowed because you have not been mentioned or " +
      "otherwise engaged by the author of the post you are replying to.";
    expect(isContentForbidden({ title: "Forbidden", detail: replyRefused })).toBe(true);
    expect(isContentForbidden(PROBLEMS.unsupportedAuth)).toBe(false);
    expect(isContentForbidden(PROBLEMS.clientForbidden)).toBe(false);
    expect(isContentForbidden({ ...PROBLEMS.duplicate, reason: "client-not-enrolled" })).toBe(
      false,
    );
    expect(isContentForbidden(PROBLEMS.bareForbidden)).toBe(false);
    expect(isContentForbidden(null)).toBe(false);
  });

  it("a 429's scope and reset come from the exhausted window", () => {
    const reset = T0 / SECOND + 900;
    const headers = (values: Record<string, string>) => new Headers(values);
    expect(rateLimit(headers(userWindowHeaders(reset)))).toStrictEqual({
      scope: "user",
      retryAt: reset * SECOND,
    });
    expect(rateLimit(headers(appWindowHeaders(reset)))).toStrictEqual({
      scope: "app",
      retryAt: reset * SECOND,
    });
    expect(rateLimit(headers(userDayHeaders(reset)))).toStrictEqual({
      scope: "user",
      retryAt: reset * SECOND,
    });
    expect(rateLimit(headers({}))).toStrictEqual({ scope: "user", retryAt: null });
    expect(rateLimit(headers({ "x-rate-limit-reset": "soon" }))).toStrictEqual({
      scope: "user",
      retryAt: null,
    });
    expect(
      rateLimit(headers({ "x-app-limit-24hour-remaining": "1", "x-rate-limit-reset": "5" })),
    ).toStrictEqual({ scope: "user", retryAt: 5 * SECOND });
  });

  it("maps a status and body to a failure", () => {
    const none = new Headers();
    expect(failureFor(403, none, PROBLEMS.duplicate)).toStrictEqual({
      kind: "content_refused",
      status: 403,
      detail: "Forbidden: You are not allowed to create a Tweet with duplicate content.",
    });
    expect(failureFor(403, none, PROBLEMS.unsupportedAuth)).toMatchObject({
      kind: "http",
      status: 403,
      scope: "user",
      retryAt: null,
    });
    expect(failureFor(400, none, PROBLEMS.duplicate)).toMatchObject({ kind: "http", status: 400 });
    expect(failureFor(429, new Headers(appWindowHeaders(10)), null)).toMatchObject({
      kind: "http",
      status: 429,
      scope: "app",
      retryAt: 10 * SECOND,
    });
  });
});

describe("XApiClient", () => {
  it("no usable token: nothing is sent", async () => {
    const { client, transport, tokens } = setup();
    tokens.result = { kind: "needs_reconnect" };
    expect(await client.call(ACCOUNT, { method: "GET", path: "/2/a" })).toStrictEqual({
      ok: false,
      failure: { kind: "no_token" },
    });
    for (const kind of ["unavailable", "refresh_does_not_fit"] as const) {
      tokens.result = { kind };
      expect(await client.call(ACCOUNT, { method: "GET", path: "/2/a" })).toStrictEqual({
        ok: false,
        failure: { kind: "not_sent" },
      });
    }
    expect(transport.seen).toHaveLength(0);
  });

  it("sends the bearer token, the query and JSON, with the default timeout", async () => {
    const { client, transport, tokens } = setup();
    transport.script(respond(200, { data: 1 }));
    const result = await client.call(ACCOUNT, {
      method: "POST",
      path: "/2/a",
      query: { q: "1 2" },
      json: { k: "v" },
    });
    expect(result).toStrictEqual({ ok: true, value: { data: 1 } });
    const seen = transport.seen[0];
    expect(seen?.url.toString()).toBe("https://api.x.com/2/a?q=1+2");
    expect(seen?.headers.get("authorization")).toBe("Bearer access-1");
    expect(seen?.headers.get("content-type")).toBe("application/json");
    expect(seen?.body).toBe('{"k":"v"}');
    expect(seen?.timeout).toBe(X_CALL_TIMEOUT);
    expect(X_CALL_TIMEOUT).toBe(15 * SECOND);
    expect(tokens.deadlines).toStrictEqual([T0 + INVOCATION]);
  });

  it("a request with no body sends none; a non-2xx is mapped; a 2xx is ok", async () => {
    const { client, transport } = setup();
    transport.script(respond(401, PROBLEMS.unauthorized), respond(204, null));
    expect(await client.call(ACCOUNT, { method: "GET", path: "/2/a" })).toMatchObject({
      ok: false,
      failure: { kind: "http", status: 401 },
    });
    expect(transport.seen[0]?.body).toBe("");
    expect(transport.seen[0]?.headers.get("content-type")).toBeNull();
    expect(await client.call(ACCOUNT, { method: "GET", path: "/2/a" })).toStrictEqual({
      ok: true,
      value: null,
    });
    transport.script(respond(302, {}), respond(300, {}));
    expect((await client.call(ACCOUNT, { method: "GET", path: "/2/a" })).ok).toBe(false);
    expect((await client.call(ACCOUNT, { method: "GET", path: "/2/a" })).ok).toBe(false);
  });

  it("transport failures pass through; a body cut off mid-read is no response", async () => {
    const { client, transport } = setup();
    const broken = new ReadableStream({
      pull(controller) {
        controller.error(new Error("reset"));
      },
    });
    transport.script(NO_RESPONSE, { kind: "response", response: new Response(broken) });
    for (let i = 0; i < 2; i += 1) {
      expect(await client.call(ACCOUNT, { method: "GET", path: "/2/a" })).toStrictEqual({
        ok: false,
        failure: { kind: "no_response" },
      });
    }
  });
});

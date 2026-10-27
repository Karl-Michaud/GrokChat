/**
 * The https `MediaFetcher` driver (plan §3.5, R13, U18) against a scripted `fetch`: the port's
 * contract, then the SSRF guard (https, allowlist, literal IPs, every redirect hop re-checked),
 * the size cap while reading, the magic bytes, and Cloudflare's 403 "error code: 1003".
 */
import { describe, expect, it, vi } from "vitest";
import {
  HttpsMediaFetcher,
  MAX_REDIRECTS,
} from "../../src/frameworks/media_fetch/https_media_fetcher";
import { ScriptedMediaFetcher } from "../../src/frameworks/memory/memory_media";
import { MEDIA_TYPES } from "../../src/use_cases/stage_media_from_url/interactor";
import { aPng, MEDIA_HOST, mediaFetcherContract } from "./media_fetcher.contract";

type Route = () => Response | Promise<Response>;

/** A `fetch` that answers from a table; anything else is a network error. */
class ScriptedWeb {
  readonly routes = new Map<string, Route>();
  readonly seen: { readonly url: string; readonly init: RequestInit | undefined }[] = [];

  readonly fetch: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    this.seen.push({ url, init });
    const route = this.routes.get(url);
    if (route === undefined) {
      throw new TypeError("Network connection lost.");
    }
    return route();
  };

  serve(url: string, bytes: Uint8Array, headers: HeadersInit = {}): void {
    this.routes.set(url, () => new Response(bytes, { status: 200, headers }));
  }

  redirect(from: string, to: string, status = 302): void {
    this.routes.set(from, () => new Response(null, { status, headers: { location: to } }));
  }
}

function driver(hosts: readonly string[] = [MEDIA_HOST, "cdn.example"]) {
  const web = new ScriptedWeb();
  return { web, fetcher: new HttpsMediaFetcher(hosts, web.fetch) };
}

const A = `https://${MEDIA_HOST}/a.png`;
const fetchA = (fetcher: HttpsMediaFetcher, url = A) => fetcher.fetch(url, 1024, MEDIA_TYPES);

describe("MediaFetcher contract: the in-memory stub", () => {
  mediaFetcherContract(() => {
    const fetcher = new ScriptedMediaFetcher();
    return { fetcher, serve: (url, bytes) => fetcher.files.set(url, bytes) };
  });
});

describe("MediaFetcher contract: the https driver", () => {
  mediaFetcherContract(() => {
    const { web, fetcher } = driver();
    return {
      fetcher,
      serve: (url, bytes) => {
        web.serve(url, bytes);
      },
    };
  });
});

describe("the https driver's SSRF guard (R13, U18)", () => {
  it("never follows a redirect itself: every request is redirect manual, with a timeout", async () => {
    const { web, fetcher } = driver();
    web.serve(A, aPng());
    expect((await fetchA(fetcher)).ok).toBe(true);
    expect(web.seen).toHaveLength(1);
    expect(web.seen[0]?.init?.redirect).toBe("manual");
    expect(web.seen[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["http", "http://media.example/a.png", "not_https"],
    ["a host off the allowlist", "https://evil.example/a.png", "host_not_allowed"],
    ["a literal IPv4 host", "https://127.0.0.1/a.png", "literal_ip"],
    ["a literal IPv6 host", "https://[::1]/a.png", "literal_ip"],
    ["credentials in the URL", "https://user@media.example/a.png", "bad_url"],
  ])("refuses %s before any request", async (_name, url, reason) => {
    const { web, fetcher } = driver();
    expect(await fetchA(fetcher, url)).toStrictEqual({ ok: false, reason });
    expect(web.seen).toHaveLength(0);
  });

  it.each([
    ["a host off the allowlist", "https://evil.example/x.png", "host_not_allowed"],
    ["http", "http://cdn.example/x.png", "not_https"],
    ["a literal IP", "https://169.254.169.254/latest/meta-data", "literal_ip"],
  ])(
    "re-checks each redirect hop: a hop to %s is refused, never requested",
    async (_n, to, why) => {
      const { web, fetcher } = driver();
      web.redirect(A, "https://cdn.example/hop.png", 301);
      web.redirect("https://cdn.example/hop.png", to, 307);
      expect(await fetchA(fetcher)).toStrictEqual({ ok: false, reason: why });
      expect(web.seen.map((seen) => seen.url)).toStrictEqual([A, "https://cdn.example/hop.png"]);
    },
  );

  it("follows allowed hops, relative ones included, up to the limit", async () => {
    const { web, fetcher } = driver();
    web.redirect(A, "/b.png", 303);
    web.redirect(`https://${MEDIA_HOST}/b.png`, "https://cdn.example/c.png", 308);
    web.serve("https://cdn.example/c.png", aPng());
    expect(await fetchA(fetcher)).toMatchObject({ ok: true, contentType: "image/png" });
    expect(web.seen).toHaveLength(3);
  });

  it(`gives up after ${String(MAX_REDIRECTS)} redirects`, async () => {
    const { web, fetcher } = driver();
    const hop = (n: number) => `https://${MEDIA_HOST}/${String(n)}.png`;
    for (let n = 0; n <= MAX_REDIRECTS + 1; n += 1) {
      web.redirect(hop(n), hop(n + 1));
    }
    web.serve(hop(MAX_REDIRECTS + 1), aPng());
    expect(await fetchA(fetcher, hop(0))).toStrictEqual({ ok: false, reason: "unreachable" });
    expect(web.seen).toHaveLength(MAX_REDIRECTS + 1);
    const { web: exact, fetcher: within } = driver();
    for (let n = 0; n < MAX_REDIRECTS; n += 1) {
      exact.redirect(hop(n), hop(n + 1));
    }
    exact.serve(hop(MAX_REDIRECTS), aPng());
    expect((await fetchA(within, hop(0))).ok).toBe(true);
  });

  it("answers unreachable for a redirect without a Location", async () => {
    const { web, fetcher } = driver();
    web.routes.set(A, () => new Response(null, { status: 302 }));
    expect(await fetchA(fetcher)).toStrictEqual({ ok: false, reason: "unreachable" });
  });

  it("treats Cloudflare's 403 'error code: 1003' as a refusal, and any other 403 as unreachable", async () => {
    const { web, fetcher } = driver();
    web.routes.set(A, () => new Response("error code: 1003", { status: 403 }));
    expect(await fetchA(fetcher)).toStrictEqual({ ok: false, reason: "host_not_allowed" });
    web.routes.set(A, () => new Response("Forbidden", { status: 403 }));
    expect(await fetchA(fetcher)).toStrictEqual({ ok: false, reason: "unreachable" });
    web.routes.set(A, () => new Response(`${"x".repeat(2048)}error code: 1003`, { status: 403 }));
    expect(await fetchA(fetcher)).toStrictEqual({ ok: false, reason: "unreachable" });
  });

  it.each([404, 500, 204, 199])("answers unreachable for HTTP %i", async (status) => {
    const { web, fetcher } = driver();
    web.routes.set(A, () =>
      status === 199
        ? ({ status, headers: new Headers(), body: null } as unknown as Response)
        : new Response(status === 204 ? null : "no", { status }),
    );
    expect(await fetchA(fetcher)).toStrictEqual({
      ok: false,
      reason: status === 204 ? "bad_type" : "unreachable",
    });
  });

  it("answers unreachable when the network fails or the fetch times out", async () => {
    const { fetcher } = driver();
    expect(await fetchA(fetcher)).toStrictEqual({ ok: false, reason: "unreachable" });
    const slow = new HttpsMediaFetcher(
      [MEDIA_HOST],
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("timed out", "TimeoutError"));
          });
        }),
      5,
    );
    expect(await fetchA(slow)).toStrictEqual({ ok: false, reason: "unreachable" });
  });
});

describe("the https driver's size and type checks", () => {
  it("refuses a declared Content-Length over the cap without reading the body", async () => {
    const { web, fetcher } = driver();
    let pulled = false;
    web.routes.set(
      A,
      () =>
        new Response(
          new ReadableStream(
            {
              pull(controller) {
                pulled = true;
                controller.enqueue(aPng());
                controller.close();
              },
            },
            { highWaterMark: 0 },
          ),
          { headers: { "content-length": "4096" } },
        ),
    );
    expect(await fetchA(fetcher)).toStrictEqual({ ok: false, reason: "too_large" });
    expect(pulled).toBe(false);
  });

  it("stops reading a body once it passes the cap, whatever its headers claim", async () => {
    const { web, fetcher } = driver();
    let chunks = 0;
    web.routes.set(
      A,
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              chunks += 1;
              controller.enqueue(chunks === 1 ? aPng(600) : new Uint8Array(600));
            },
          }),
          { headers: { "content-length": "10" } },
        ),
    );
    expect(await fetchA(fetcher)).toStrictEqual({ ok: false, reason: "too_large" });
    expect(chunks).toBeLessThanOrEqual(3);
  });

  it("assembles a body sent in chunks, at exactly the cap", async () => {
    const { web, fetcher } = driver();
    const png = aPng(1024);
    web.routes.set(
      A,
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(png.slice(0, 500));
              controller.enqueue(png.slice(500));
              controller.close();
            },
          }),
        ),
    );
    expect(await fetchA(fetcher)).toStrictEqual({ ok: true, bytes: png, contentType: "image/png" });
  });

  it("decides the type by the magic bytes, never by the claimed Content-Type", async () => {
    const { web, fetcher } = driver();
    web.serve(A, new TextEncoder().encode("<svg onload=alert(1)>"), {
      "content-type": "image/png",
    });
    expect(await fetchA(fetcher)).toStrictEqual({ ok: false, reason: "bad_type" });
    web.serve(A, aPng(), { "content-type": "text/html" });
    expect(await fetchA(fetcher)).toMatchObject({ ok: true, contentType: "image/png" });
  });
});

describe("the https driver's default fetch", () => {
  it("is the global fetch, called with redirect manual", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(new Response(aPng())));
    try {
      expect(await fetchA(new HttpsMediaFetcher([MEDIA_HOST]))).toMatchObject({ ok: true });
      expect(spy).toHaveBeenCalledWith(A, expect.objectContaining({ redirect: "manual" }));
    } finally {
      spy.mockRestore();
    }
  });
});

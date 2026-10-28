import { env } from "cloudflare:workers";
import type { Env } from "../../../src/frameworks/env";
import { hashPassword } from "../../../src/frameworks/web/password";
import { buildWebApp } from "../../../src/frameworks/web/web_app";
import type { WebControllers } from "../../../src/frameworks/web/controllers";
import { AccountsController } from "../../../src/interface_adapters/dashboard/accounts_controller";
import { OAuthController } from "../../../src/interface_adapters/dashboard/oauth_controller";
import { PostCommandsController } from "../../../src/interface_adapters/dashboard/post_commands_controller";
import { PostsController } from "../../../src/interface_adapters/dashboard/posts_controller";
import { ActivityController } from "../../../src/interface_adapters/dashboard/activity_controller";
import { AnalyticsController } from "../../../src/interface_adapters/dashboard/analytics_controller";
import { SessionController } from "../../../src/interface_adapters/dashboard/session_controller";
import { dashboardUseCases } from "../../unit/support/dashboard";
import { makeWorld, type World } from "../../unit/support/world";

export const ORIGIN = "https://grokchat.test";
export const PASSWORD = "correct horse battery staple";
export const SESSION_SECRET = "test-session-secret-0123456789abcdef";
export const X_CLIENT_ID = "test-x-client-id";

let hash: Promise<string> | undefined;

/** The Worker's env with the dashboard's and the X app's secrets and var set (test values only). */
export async function webEnv(overrides: Partial<Env> = {}): Promise<Env> {
  hash ??= hashPassword(PASSWORD, new Uint8Array(16).fill(7));
  return {
    ...env,
    GROKCHAT_SESSION_SECRET: SESSION_SECRET,
    GROKCHAT_ADMIN_PASSWORD_HASH: await hash,
    GROKCHAT_PUBLIC_ORIGIN: ORIGIN,
    X_CLIENT_ID: X_CLIENT_ID,
    X_CLIENT_SECRET: "test-x-client-secret",
    ...overrides,
  };
}

export function controllersFor(world: World): WebControllers {
  const useCases = dashboardUseCases(world);
  return {
    session: (verifier) => new SessionController(dashboardUseCases(world, verifier)),
    analytics: new AnalyticsController(useCases),
    posts: new PostsController(useCases, world.clock),
    postCommands: new PostCommandsController(useCases),
    accounts: new AccountsController(useCases),
    oauth: new OAuthController(useCases),
    activity: new ActivityController(useCases, world.clock),
  };
}

type Fetch = (request: Request, env: Env) => Response | Promise<Response>;

/** A browser of one: it keeps cookies, sends our Origin on POSTs and reads the CSRF token. */
export class Browser {
  readonly cookies = new Map<string, string>();
  csrf = "";

  constructor(
    private readonly fetcher: Fetch,
    private readonly env: Env,
  ) {}

  async get(path: string, headers: Record<string, string> = {}): Promise<Response> {
    return this.send(new Request(`${ORIGIN}${path}`, { headers: this.headers(headers) }));
  }

  async post(
    path: string,
    form: Record<string, string | readonly string[]> = {},
    options: { readonly origin?: string | null; readonly csrf?: string | null } = {},
  ): Promise<Response> {
    const body = new URLSearchParams();
    const csrf = options.csrf === undefined ? this.csrf : options.csrf;
    if (csrf !== null) {
      body.append("_csrf", csrf);
    }
    for (const [name, value] of Object.entries(form)) {
      for (const item of typeof value === "string" ? [value] : value) {
        body.append(name, item);
      }
    }
    const origin = options.origin === undefined ? ORIGIN : options.origin;
    const headers = this.headers(origin === null ? {} : { origin });
    headers.set("content-type", "application/x-www-form-urlencoded");
    return this.send(new Request(`${ORIGIN}${path}`, { method: "POST", headers, body }));
  }

  async login(password = PASSWORD): Promise<Response> {
    const response = await this.post("/dashboard/login", { password });
    if (response.status === 303) {
      await this.page("/dashboard/analytics");
    }
    return response;
  }

  /** GETs a page and keeps its CSRF token. */
  async page(path: string): Promise<{ readonly status: number; readonly html: string }> {
    const response = await this.get(path);
    const html = await response.text();
    const token = /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
    if (token !== undefined) {
      this.csrf = token;
    }
    return { status: response.status, html };
  }

  /** Sends a request as given, through the same app and env. */
  raw(request: Request): Promise<Response> {
    return Promise.resolve(this.fetcher(request, this.env));
  }

  private headers(extra: Record<string, string>): Headers {
    const headers = new Headers(extra);
    const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    if (cookie !== "") {
      headers.set("cookie", cookie);
    }
    return headers;
  }

  private async send(request: Request): Promise<Response> {
    const response = await this.fetcher(request, this.env);
    for (const line of response.headers.getSetCookie()) {
      const [pair = ""] = line.split(";");
      const [name = "", ...value] = pair.split("=");
      const joined = value.join("=");
      if (joined === "" || /max-age=0/i.test(line)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, joined);
      }
    }
    return response;
  }
}

/** The dashboard over an in-memory world, and a browser for it. */
export async function dashboard(overrides: Partial<Env> = {}) {
  const world = makeWorld();
  const app = buildWebApp(controllersFor(world));
  const workerEnv = await webEnv(overrides);
  const browser = new Browser((request, e) => app.fetch(request, e), workerEnv);
  return { world, app, env: workerEnv, browser };
}

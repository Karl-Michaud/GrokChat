import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { AccountOption } from "../../../interface_adapters/dashboard/account_directory";
import type { PageFrame } from "../respond";
import { APP_CSS, APP_JS, HTMX } from "../static_assets";
import { csrfField } from "./components";
import { icon, type IconName } from "./icons";

/**
 * A fragment of a page. A plain string is escaped wherever it is interpolated, so the empty string
 * (nothing to show) is the only one a view returns.
 */
export type Html = "" | HtmlEscapedString | Promise<HtmlEscapedString>;

const NAV: readonly (readonly [string, string, IconName])[] = [
  ["/dashboard/analytics", "Analytics", "analytics"],
  ["/dashboard/posts", "Posts", "posts"],
  ["/dashboard/accounts", "Accounts", "accounts"],
  ["/dashboard/activity", "Activity", "activity"],
];

/** What a page puts in the shell. */
export interface Page {
  readonly title: string;
  readonly subtitle?: string;
  /** The top bar's controls (the range picker). */
  readonly tools?: Html;
  /** The sidebar's account filter: the accounts, and the fields to keep when it changes. */
  readonly switcher?: {
    readonly accounts: readonly AccountOption[];
    readonly keep: Readonly<Record<string, string>>;
  };
  readonly body: Html;
}

function head(title: string): Html {
  return html`<meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta
      name="htmx-config"
      content='{"allowEval":false,"allowScriptTags":false,"includeIndicatorStyles":false,"historyCacheSize":0,"refreshOnHistoryMiss":true,"responseHandling":[{"code":".*","swap":true}]}'
    />
    <title>${title} · GrokChat</title>
    <link rel="stylesheet" href="${APP_CSS.path}" />
    <script src="${HTMX.path}" integrity="${HTMX.integrity}" crossorigin="anonymous" defer></script>
    <script src="${APP_JS.path}" defer></script>`;
}

/**
 * Every page: htmx boosts links and forms (no build step, no client framework), with eval off, no
 * injected styles, no history cache (a cached page would hold the CSRF token), and every response
 * swapped in so a refusal is shown. The theme is the cookie's, or the system's.
 */
function documentOf(title: string, frame: PageFrame, body: Html): Html {
  const theme = frame.theme === "system" ? "" : frame.theme;
  return html`<!doctype html>
    <html lang="en" ${theme === "" ? "" : html`data-theme="${theme}"`}>
      <head>
        ${head(title)}
      </head>
      ${body}
    </html>`;
}

function nav(path: string): Html {
  return html`<nav class="nav" aria-label="Main">
    ${NAV.map(([href, label, name]) => {
      const current = path === href || path.startsWith(`${href}/`);
      return html`<a href="${href}" ${current ? html`aria-current="page"` : ""}
        >${icon(name)}<span>${label}</span></a
      >`;
    })}
  </nav>`;
}

function switcher(page: Page, path: string): Html {
  if (page.switcher === undefined) {
    return "";
  }
  const { accounts, keep } = page.switcher;
  return html`<form class="sidebar-section" method="get" action="${path}" data-autosubmit>
    <label class="sidebar-label" for="account-switch">Account</label>
    ${Object.entries(keep).map(([name, value]) => html`<input type="hidden" name="${name}" value="${value}" />`)}
    <select id="account-switch" name="account" aria-label="Account">
      <option value="">All accounts</option>
      ${accounts.map(
        (account) =>
          html`<option value="${account.id}" ${account.selected ? "selected" : ""}>
            ${account.handle}
          </option>`,
      )}
    </select>
    <button class="btn btn-sm js-hide">Apply</button>
  </form>`;
}

const THEME_LABEL = {
  system: "Theme: system",
  light: "Theme: light",
  dark: "Theme: dark",
} as const;

function foot(frame: PageFrame): Html {
  return html`<div class="sidebar-foot">
    <form method="post" action="/dashboard/theme" hx-boost="false" class="inline-form">
      ${csrfField(frame.csrf)}<input type="hidden" name="back" value="${frame.path}" />
      <button class="btn btn-ghost btn-block" title="Switch between system, light and dark">
        ${icon("theme")}<span class="btn-label">${THEME_LABEL[frame.theme]}</span>
      </button>
    </form>
    <form method="post" action="/dashboard/logout" class="inline-form">
      ${csrfField(frame.csrf)}
      <button class="btn btn-ghost btn-block">
        ${icon("logout")}<span class="btn-label">Log out</span>
      </button>
    </form>
  </div>`;
}

export function shell(page: Page, frame: PageFrame): Html {
  return documentOf(
    page.title,
    frame,
    html`<body hx-boost="true">
      <div class="app">
        <aside class="sidebar">
          <a class="brand" href="/dashboard/analytics"
            ><span class="brand-mark">${icon("mark")}</span><span>GrokChat</span></a
          >
          ${nav(frame.path)} ${switcher(page, frame.path)} ${foot(frame)}
        </aside>
        <div class="main">
          <header class="topbar">
            <div class="topbar-title">
              <h1>${page.title}</h1>
              ${page.subtitle === undefined ? "" : html`<p class="muted">${page.subtitle}</p>`}
            </div>
            ${page.tools === undefined ? "" : html`<div class="topbar-tools">${page.tools}</div>`}
          </header>
          <main class="content">${page.body}</main>
        </div>
      </div>
    </body>`,
  );
}

export function errorPage(message: string, frame: PageFrame): Html {
  const body = html`<div class="card">
    <div class="empty" role="alert">
      ${icon("inbox")}<strong>${message}</strong>
      <a class="btn" href="/dashboard/analytics">Back to the dashboard</a>
    </div>
  </div>`;
  return frame.csrf === ""
    ? authPage("Refused", body, frame)
    : shell({ title: "Refused", body }, frame);
}

function authPage(title: string, body: Html, frame: PageFrame): Html {
  return documentOf(
    title,
    frame,
    html`<body>
      <main class="auth">
        <div class="card auth-card">
          <div class="brand">
            <span class="brand-mark">${icon("mark")}</span><span>GrokChat</span>
          </div>
          ${body}
        </div>
      </main>
    </body>`,
  );
}

export function loginPage(message: string | null, frame: PageFrame): Html {
  return authPage(
    "Log in",
    html`<div class="stack">
        <h1>Welcome back</h1>
        <p class="muted">Sign in to manage your accounts, posts and analytics.</p>
      </div>
      ${message === null ? "" : html`<p class="alert" role="alert">${message}</p>`}
      <form method="post" action="/dashboard/login">
        <label
          >Password
          <input type="password" name="password" autocomplete="current-password" required autofocus
        /></label>
        <button class="btn btn-primary">Log in</button>
      </form>`,
    frame,
  );
}

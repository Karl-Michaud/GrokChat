import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { HTMX } from "../static_assets";

export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

const NAV: readonly (readonly [string, string])[] = [
  ["/dashboard/backlog", "Backlog"],
  ["/dashboard/calendar", "Calendar"],
  ["/dashboard/accounts", "Accounts"],
  ["/dashboard/metrics", "Metrics"],
  ["/dashboard/costs", "Costs"],
  ["/dashboard/media", "Media"],
  ["/dashboard/audit", "Audit"],
];

/** The session's CSRF token, carried by every form (plan §3.5, m4). */
export function csrfField(token: string): Html {
  return html`<input type="hidden" name="_csrf" value="${token}" />`;
}

/** A form with one button that posts to `action`. */
export function button(action: string, label: string, csrf: string): Html {
  return html`<form method="post" action="${action}">
    ${csrfField(csrf)}<button>${label}</button>
  </form>`;
}

export function select(
  name: string,
  options: readonly {
    readonly value: string;
    readonly label: string;
    readonly selected: boolean;
  }[],
  any: string | null,
): Html {
  return html`<select name="${name}">
    ${any === null ? "" : html`<option value="">${any}</option>`}
    ${options.map(
      (option) =>
        html`<option value="${option.value}" ${option.selected ? "selected" : ""}>
          ${option.label}
        </option>`,
    )}
  </select>`;
}

function nav(csrf: string): Html {
  return html`<nav>
    ${NAV.map(([href, label]) => html`<a href="${href}">${label}</a> `)}
    <form method="post" action="/dashboard/logout">${csrfField(csrf)}<button>Log out</button></form>
  </nav>`;
}

/**
 * Every page: htmx boosts links and forms (no build step, no client framework), with eval off, no
 * injected styles, no history cache (a cached page would hold the CSRF token), and every response
 * swapped in so a refusal is shown.
 */
export function layout(title: string, csrf: string | null, body: Html): Html {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          name="htmx-config"
          content='{"allowEval":false,"allowScriptTags":false,"includeIndicatorStyles":false,"historyCacheSize":0,"refreshOnHistoryMiss":true,"responseHandling":[{"code":".*","swap":true}]}'
        />
        <title>${title} · GrokChat</title>
        <script
          src="${HTMX.path}"
          integrity="${HTMX.integrity}"
          crossorigin="anonymous"
          defer
        ></script>
      </head>
      <body hx-boost="true">
        ${csrf === null ? "" : nav(csrf)}
        <main>
          <h1>${title}</h1>
          ${body}
        </main>
      </body>
    </html>`;
}

export function errorPage(message: string, csrf: string | null): Html {
  return layout(
    "Refused",
    csrf,
    html`<p role="alert">${message}</p>
      <p><a href="/dashboard/backlog">Back</a></p>`,
  );
}

export function loginPage(message: string | null): Html {
  return layout(
    "Log in",
    null,
    html`${message === null ? "" : html`<p role="alert">${message}</p>`}
      <form method="post" action="/dashboard/login">
        <label
          >Password <input type="password" name="password" autocomplete="current-password" required
        /></label>
        <button>Log in</button>
      </form>`,
  );
}

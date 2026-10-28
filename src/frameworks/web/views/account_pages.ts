import { html } from "hono/html";
import type {
  AccountRowView,
  AccountsView,
} from "../../../interface_adapters/dashboard/accounts_controller";
import type { PolicyForm } from "../../../interface_adapters/dashboard/policy_form";
import { button, csrfField, layout, select, type Html } from "./layout";

const checked = (on: boolean) => (on ? "checked" : "");

function policyFields(policy: PolicyForm): Html {
  const choice = (values: readonly string[], current: string) =>
    values.map((value) => ({ value, label: value, selected: value === current }));
  return html`<label>Mode ${select("mode", choice(["AUTO", "REVIEW"], policy.mode), null)}</label>
    <label>Daily cap <input name="dailyCap" value="${policy.dailyCap}" size="4" /></label>
    <label
      >Minimum gap (min) <input name="minGapMinutes" value="${policy.minGapMinutes}" size="4"
    /></label>
    <label>Quiet from <input type="time" name="quietStart" value="${policy.quietStart}" /></label>
    <label>to <input type="time" name="quietEnd" value="${policy.quietEnd}" /></label>
    <label>Time zone <input name="tz" value="${policy.tz}" /></label>
    <label
      >Scheme URLs
      ${select("linkPolicy", choice(["ALLOW", "REFUSE"], policy.linkPolicy), null)}</label
    >
    <label
      >Grace (min) <input name="graceMinutes" value="${policy.graceMinutes}" size="4"
    /></label>`;
}

/** The OAuth start leaves for x.com, so it is a plain form, not boosted. */
function connectForm(csrf: string, fields: Html, label: string): Html {
  return html`<form method="post" action="/oauth/x/start" hx-boost="false">
    ${csrfField(csrf)}${fields}<button>${label}</button>
  </form>`;
}

function account(row: AccountRowView, csrf: string): Html {
  const base = `/dashboard/accounts/${encodeURIComponent(row.id)}`;
  return html`<section>
    <h2>${row.handle}</h2>
    <p>Status: <strong>${row.status}</strong></p>
    <p>Account id (for <code>npm run add-bot</code>): <code>${row.id}</code></p>
    ${
      row.needsReconnect
        ? html`<p role="alert">Publishing is refused until this account is reconnected on X.</p>`
        : ""
    }
    ${row.canPause ? button(`${base}/status?to=PAUSED`, "Pause (kill switch)", csrf) : ""}
    ${row.canActivate ? button(`${base}/status?to=ACTIVE`, "Activate", csrf) : ""}
    ${connectForm(csrf, html`<input type="hidden" name="reconnect" value="${row.id}" />`, "Reconnect on X")}
    <form method="post" action="${base}/disclosure">
      ${csrfField(csrf)}
      <label
        ><input type="checkbox" name="bioConfirmed" value="yes" ${checked(row.bioConfirmed)} /> The
        bio says MuseChat runs it</label
      >
      <label
        ><input
          type="checkbox"
          name="automatedLabelConfirmed"
          value="yes"
          ${checked(row.automatedLabelConfirmed)}
        />
        X's "automated" label is on</label
      >
      <button>Save disclosure</button>
    </form>
    <form method="post" action="${base}/policy">
      ${csrfField(csrf)}${policyFields(row.policy)}<button>Save policy</button>
    </form>
  </section>`;
}

export function accountsPage(view: AccountsView, csrf: string): Html {
  return layout(
    "Accounts",
    csrf,
    html`${view.notice === null ? "" : html`<p role="status">${view.notice}</p>`}
      ${view.accounts.length === 0 ? html`<p>No accounts yet.</p>` : view.accounts.map((row) => account(row, csrf))}
      <h2>Connect a new account</h2>
      ${connectForm(csrf, html``, "Connect on X")}`,
  );
}

/** Navigates on from our own origin, so the browser sends the Strict session cookie. */
export function bouncePage(next: string): Html {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta http-equiv="refresh" content="0; url=${next}" />
        <title>Connecting · GrokChat</title>
      </head>
      <body>
        <p><a href="${next}">Finish connecting the account</a></p>
      </body>
    </html>`;
}

import { html } from "hono/html";
import type {
  AccountCard,
  AccountsView,
} from "../../../interface_adapters/dashboard/accounts_controller";
import type { PolicyForm } from "../../../interface_adapters/dashboard/policy_form";
import type { PageFrame } from "../respond";
import { avatar, chip, copyField, csrfField, empty } from "./components";
import { icon } from "./icons";
import { shell, type Html } from "./layout";

const checked = (on: boolean) => (on ? "checked" : "");

function choice(
  name: string,
  values: readonly (readonly [string, string])[],
  current: string,
  label: string,
): Html {
  return html`<label
    >${label}
    <select name="${name}">
      ${values.map(([value, text]) => html`<option value="${value}" ${value === current ? "selected" : ""}>${text}</option>`)}
    </select></label
  >`;
}

function policyFields(policy: PolicyForm): Html {
  return html`<div class="form-grid">
    ${choice(
      "mode",
      [
        ["AUTO", "Auto-publish"],
        ["REVIEW", "Review first"],
      ],
      policy.mode,
      "Mode",
    )}
    ${choice(
      "linkPolicy",
      [
        ["ALLOW", "Allowed"],
        ["REFUSE", "Refused"],
      ],
      policy.linkPolicy,
      "https:// links",
    )}
    <label
      >Posts a day <input name="dailyCap" value="${policy.dailyCap}" inputmode="numeric"
    /></label>
    <label
      >Minutes apart
      <input name="minGapMinutes" value="${policy.minGapMinutes}" inputmode="numeric"
    /></label>
    <label>Quiet from <input type="time" name="quietStart" value="${policy.quietStart}" /></label>
    <label>Quiet until <input type="time" name="quietEnd" value="${policy.quietEnd}" /></label>
    <label>Time zone <input name="tz" value="${policy.tz}" /></label>
    <label
      >Grace (minutes)
      <input name="graceMinutes" value="${policy.graceMinutes}" inputmode="numeric"
    /></label>
  </div>`;
}

/** The OAuth start leaves for x.com, so it is a plain form, not boosted. */
function connectForm(
  csrf: string,
  reconnect: string | null,
  label: string,
  className: string,
): Html {
  return html`<form method="post" action="/oauth/x/start" hx-boost="false" class="inline-form">
    ${csrfField(csrf)}${reconnect === null ? "" : html`<input type="hidden" name="reconnect" value="${reconnect}" />`}
    <button class="${className}">${label}</button>
  </form>`;
}

function killSwitch(account: AccountCard, csrf: string, base: string): Html {
  if (!account.canActivate && !account.canPause) {
    return "";
  }
  const to = account.canPause ? "PAUSED" : "ACTIVE";
  const label = account.canPause ? "Publishing on" : "Paused";
  return html`<form method="post" action="${base}/status?to=${to}" class="inline-form">
    ${csrfField(csrf)}
    <button
      class="switch"
      role="switch"
      aria-checked="${account.canPause ? "true" : "false"}"
      title="${account.canPause ? "Pause publishing (kill switch)" : "Resume publishing"}"
    >
      <span class="switch-track" aria-hidden="true"></span><span>${label}</span>
    </button>
  </form>`;
}

function disclosure(account: AccountCard, csrf: string, base: string): Html {
  return html`<form method="post" action="${base}/disclosure" class="checklist">
    ${csrfField(csrf)}
    <label class="check"
      ><input type="checkbox" name="bioConfirmed" value="yes" ${checked(account.bioConfirmed)} />
      The bio says MuseChat runs it</label
    >
    <label class="check"
      ><input
        type="checkbox"
        name="automatedLabelConfirmed"
        value="yes"
        ${checked(account.automatedLabelConfirmed)}
      />
      X's "Automated" label is on</label
    >
    <div><button class="btn btn-sm">Save disclosure</button></div>
  </form>`;
}

function head(account: AccountCard): Html {
  return html`<div class="account-top">
      ${avatar(account.badge, "lg")}
      <div class="stack">
        <div class="spread">
          <h2>${account.badge.handle}</h2>
          ${chip(account.status)}
        </div>
        <span class="faint">${account.mode}</span>
      </div>
    </div>
    <div class="account-stats">
      <div><strong>${account.followers}</strong><span>Followers</span></div>
      <div><strong>${account.posts7d}</strong><span>Posts, 7 days</span></div>
      <div><strong>${account.disclosed ? "Done" : "To do"}</strong><span>Disclosure</span></div>
    </div>`;
}

function accountCard(account: AccountCard, csrf: string): Html {
  const base = `/dashboard/accounts/${encodeURIComponent(account.id)}`;
  return html`<article class="card account-card">
    ${head(account)}
    ${account.needsReconnect ? html`<div class="account-section"><p class="callout critical" role="alert">Publishing is refused until this account is reconnected on X.</p></div>` : ""}
    <div class="account-section">
      <div class="spread">
        ${killSwitch(account, csrf, base)}
        ${connectForm(csrf, account.id, "Reconnect on X", account.needsReconnect ? "btn btn-primary btn-sm" : "btn btn-sm")}
      </div>
      <ul class="limits">
        ${account.limits.map((limit) => html`<li>${limit}</li>`)}
      </ul>
    </div>
    <div class="account-section">
      <h3>
        Disclosure
        ${account.disclosed ? "" : html`<span class="chip warning">Required before publishing</span>`}
      </h3>
      ${disclosure(account, csrf, base)}
    </div>
    <div class="account-section">
      <details class="disclose">
        <summary>Posting policy</summary>
        <form method="post" action="${base}/policy" class="stack">
          ${csrfField(csrf)}${policyFields(account.policy)}
          <div><button class="btn btn-primary btn-sm">Save policy</button></div>
        </form>
      </details>
    </div>
    <div class="account-section">
      <span class="faint">Account id, for <code>add-bot</code></span>
      ${copyField(account.id, "account id")}
    </div>
  </article>`;
}

function botPanel(view: AccountsView): Html {
  return html`<section class="card">
    <div class="card-head">
      <div class="row">
        ${icon("bot")}
        <h2>Connect a Grok bot</h2>
      </div>
      <p>Grok writes in the account's voice; GrokChat posts and schedules for it.</p>
    </div>
    <div class="card-body">
      <ol class="steps">
        <li>
          Give the bot a token for its accounts (run in the GrokChat
          repo):${copyField(view.addBot, "add-bot command")}
        </li>
        <li>
          Add GrokChat to the bot as a remote MCP server, with the token as its
          authorization:${copyField(view.mcpUrl, "MCP server URL")}
        </li>
        <li>
          Test it with one <code>get_policy</code> call: a wrong token fails the whole Grok request.
        </li>
      </ol>
    </div>
  </section>`;
}

export function accountsPage(view: AccountsView, frame: PageFrame): Html {
  const connect = connectForm(frame.csrf, null, "Connect X account", "btn btn-primary");
  const cards =
    view.accounts.length === 0
      ? html`<section class="card">
          ${empty("accounts", "No accounts yet", "Connect the first X account. It starts paused, so nothing is posted until you finish its disclosure and turn it on.", connect)}
        </section>`
      : html`<div class="account-grid">
          ${view.accounts.map((account) => accountCard(account, frame.csrf))}
        </div>`;
  return shell(
    {
      title: "Accounts",
      subtitle: "The X accounts GrokChat posts to",
      tools: connect,
      body: html`${view.notice === null ? "" : html`<p class="callout good" role="status">${view.notice}</p>`}
      ${cards} ${botPanel(view)}`,
    },
    frame,
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

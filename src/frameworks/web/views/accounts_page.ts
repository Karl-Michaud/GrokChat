import { html } from "hono/html";
import type {
  AccountCard,
  AccountsView,
  PersonGroup,
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
      ${ownerForm(account, csrf, base)}
      <span class="faint">Account id</span>
      ${copyField(account.id, "account id")}
    </div>
  </article>`;
}

/** The Owner select (GROKCHAT-16): saves on change with JS, with a Save button without it. */
function ownerForm(account: AccountCard, csrf: string, base: string): Html {
  const id = `owner-${account.id}`;
  return html`<form method="post" action="${base}/owner" class="owner-form" data-autosubmit>
    ${csrfField(csrf)}
    <label for="${id}">Owner</label>
    <div class="row">
      <select id="${id}" name="person">
        ${account.owners.map((option) => html`<option value="${option.value}" ${option.selected ? "selected" : ""}>${option.label}</option>`)}
      </select>
      <button class="btn btn-sm js-hide">Save</button>
    </div>
  </form>`;
}

/** How a person's bot gets in (GROKCHAT-16): one token per person, never per account. */
function botPanel(view: AccountsView): Html {
  return html`<section class="card">
    <div class="card-head">
      <div class="row">
        ${icon("bot")}
        <h2>Connect a Grok bot</h2>
      </div>
      <p>Each person runs one Grok bot, with one token for all of their accounts.</p>
    </div>
    <div class="card-body">
      <ol class="steps">
        <li>Add the person, then set each of their accounts' <strong>Owner</strong> to them.</li>
        <li>
          Press <strong>Generate token</strong> in their section. Copy the token and the connector
          settings into their Grok bot (name <code>grokchat</code>, header
          <code>Authorization: Bearer &lt;token&gt;</code
          >):${copyField(view.mcpUrl, "MCP server URL")}
        </li>
        <li>
          Paste the setup prompt shown with the token. The bot finds its accounts with
          <code>list_accounts</code>. An account you assign later reaches the same token: nothing to
          reissue.
        </li>
      </ol>
    </div>
  </section>`;
}

function newPersonForm(csrf: string): Html {
  return html`<form method="post" action="/dashboard/people" class="new-person">
    ${csrfField(csrf)}
    <label for="new-person" class="visually-hidden">Name of the new person</label>
    <input id="new-person" name="name" placeholder="Name, e.g. Aaron" required maxlength="60" />
    <button class="btn">${icon("plus")}<span>New person</span></button>
  </form>`;
}

/** Generate needs one press; rotate revokes a live token, so it asks first (no JS dialogs). */
function tokenControl(person: PersonGroup, csrf: string, base: string): Html {
  const form = (label: string, className: string) =>
    html`<form method="post" action="${base}/token" hx-boost="false" class="inline-form">
      ${csrfField(csrf)}<button class="${className}">${icon("key")}<span>${label}</span></button>
    </form>`;
  if (!person.hasToken) {
    return form("Generate token", "btn btn-primary btn-sm");
  }
  return html`<details class="pop">
    <summary class="btn btn-sm">${icon("key")}<span>Rotate token</span></summary>
    <div class="pop-body">
      <p>
        ${person.name}'s current token stops working at once. Put the new one in their bot's
        connector right after.
      </p>
      ${form("Rotate now", "btn btn-primary btn-sm")}
    </div>
  </details>`;
}

function renameControl(person: PersonGroup, csrf: string, base: string): Html {
  return html`<details class="pop">
    <summary class="btn btn-sm btn-ghost">Rename</summary>
    <div class="pop-body">
      <form method="post" action="${base}/rename" class="stack">
        ${csrfField(csrf)}
        <label>New name <input name="name" value="${person.name}" required maxlength="60" /></label>
        <div><button class="btn btn-primary btn-sm">Save name</button></div>
      </form>
    </div>
  </details>`;
}

function deleteControl(person: PersonGroup, csrf: string, base: string): Html {
  return html`<details class="pop">
    <summary class="btn btn-sm btn-ghost btn-danger">Delete</summary>
    <div class="pop-body">
      <form method="post" action="${base}/delete" class="stack">
        ${csrfField(csrf)}
        <p>
          Their ${person.count} become Unassigned and their token stops working. Type
          <strong>${person.name}</strong> to confirm.
        </p>
        <label>Name <input name="confirmation" required autocomplete="off" /></label>
        <div><button class="btn btn-sm btn-danger">Delete ${person.name}</button></div>
      </form>
    </div>
  </details>`;
}

function personSection(person: PersonGroup, csrf: string): Html {
  const base = `/dashboard/people/${encodeURIComponent(person.id)}`;
  const tokenChip = html`<span class="chip ${person.hasToken ? "good" : "warning"}"
    >${person.token}</span
  >`;
  return html`<section class="person" aria-label="${person.name}">
    <header class="person-head">
      <div class="person-who">
        <span class="avatar t${String(person.tone)} lg" aria-hidden="true">${person.initials}</span>
        <div class="stack">
          <h2>${person.name}</h2>
          <span class="person-meta"><span class="faint">${person.count}</span>${tokenChip}</span>
        </div>
      </div>
      <div class="person-actions">
        ${tokenControl(person, csrf, base)} ${renameControl(person, csrf, base)}
        ${deleteControl(person, csrf, base)}
      </div>
    </header>
    ${
      person.accounts.length === 0
        ? html`<p class="person-empty">
            No accounts yet. Set an account's <strong>Owner</strong> to ${person.name}.
          </p>`
        : html`<div class="account-grid">
            ${person.accounts.map((account) => accountCard(account, csrf))}
          </div>`
    }
  </section>`;
}

function unassignedSection(view: AccountsView, csrf: string): Html {
  if (view.unassigned.length === 0) {
    return "";
  }
  return html`<section class="person" aria-label="Unassigned">
    <header class="person-head">
      <div class="person-who">
        <span class="avatar t0 lg" aria-hidden="true">?</span>
        <div class="stack">
          <h2>Unassigned</h2>
          <span class="faint">No bot can post to these until you give them an Owner.</span>
        </div>
      </div>
    </header>
    <div class="account-grid">${view.unassigned.map((account) => accountCard(account, csrf))}</div>
  </section>`;
}

export function accountsPage(view: AccountsView, frame: PageFrame): Html {
  const connect = connectForm(frame.csrf, null, "Connect X account", "btn btn-primary");
  const body =
    view.total === 0 && view.people.length === 0
      ? html`<section class="card">
          ${empty("accounts", "No accounts yet", "Connect the first X account. It starts paused, so nothing is posted until you finish its disclosure and turn it on.", connect)}
        </section>`
      : html`${view.people.map((person) => personSection(person, frame.csrf))}
        ${unassignedSection(view, frame.csrf)}`;
  return shell(
    {
      title: "Accounts",
      subtitle: "The X accounts GrokChat posts to, by the person whose bot runs them",
      tools: html`${newPersonForm(frame.csrf)}${connect}`,
      body: html`${view.notice === null ? "" : html`<p class="callout good" role="status">${view.notice}</p>`}
      ${body} ${botPanel(view)}`,
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

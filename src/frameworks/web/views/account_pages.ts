import { html } from "hono/html";
import type {
  AccountRowView,
  AccountsView,
} from "../../../interface_adapters/dashboard/accounts_controller";
import type { PersonalitiesView } from "../../../interface_adapters/dashboard/personalities_controller";
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
    <h2>${row.handle} (${row.personality})</h2>
    <p>Status: <strong>${row.status}</strong></p>
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
  const personalities = view.personalities.map((p) => ({
    value: p.id,
    label: p.name,
    selected: false,
  }));
  return layout(
    "Accounts",
    csrf,
    html`${view.notice === null ? "" : html`<p role="status">${view.notice}</p>`}
      ${view.accounts.length === 0 ? html`<p>No accounts yet.</p>` : view.accounts.map((row) => account(row, csrf))}
      <h2>Connect a new account</h2>
      ${
        view.personalities.length === 0
          ? html`<p>Create a personality first.</p>`
          : connectForm(
              csrf,
              html`<label>Personality ${select("personality", personalities, null)}</label>`,
              "Connect on X",
            )
      }`,
  );
}

function personalityForm(
  csrf: string,
  row: PersonalitiesView["personalities"][number] | null,
): Html {
  const field = (name: string, label: string, value: string) =>
    html`<p>
      <label>${label}<br /><textarea name="${name}" rows="3" cols="60">${value}</textarea></label>
    </p>`;
  return html`<form method="post" action="/dashboard/personalities">
    ${csrfField(csrf)}
    <input type="hidden" name="id" value="${row?.id ?? ""}" />
    <p>
      <label>Name <input name="name" value="${row?.name ?? ""}" required /></label>
    </p>
    ${field("voiceGuide", "Voice guide", row?.voiceGuide ?? "")}
    ${field("topics", "Topics (one per line)", row?.topics ?? "")}
    ${field("dos", "Dos (one per line)", row?.dos ?? "")}
    ${field("donts", "Don'ts (one per line)", row?.donts ?? "")}
    ${field("examples", "Examples (one per line)", row?.examples ?? "")}
    <button>${row === null ? "Create" : "Save"}</button>
  </form>`;
}

export function personalitiesPage(view: PersonalitiesView, csrf: string): Html {
  return layout(
    "Personalities",
    csrf,
    html`${view.personalities.map(
        (row) =>
          html`<section>
            <h2>${row.name} (version ${row.version})</h2>
            ${personalityForm(csrf, row)}
          </section>`,
      )}
      <section>
        <h2>New personality</h2>
        ${personalityForm(csrf, null)}
      </section>`,
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

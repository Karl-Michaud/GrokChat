import { html } from "hono/html";
import type {
  StaleTokenView,
  TokenPanel,
  TokenView,
} from "../../../interface_adapters/dashboard/people_controller";
import type { PageFrame } from "../respond";
import { copyField, csrfField } from "./components";
import { icon } from "./icons";
import { shell, type Html } from "./layout";

function accountsLine(view: TokenView): string {
  const handles = view.accounts.map((account) => `@${account.handle}`);
  return handles.length === 0
    ? `${view.personName} has no account yet: set an account's Owner to them, and the bot sees it.`
    : `It reaches ${handles.join(", ")}, and any account you give ${view.personName} later.`;
}

function tokenCard(view: TokenView): Html {
  return html`<section class="card">
    <div class="card-head">
      <div class="row">
        ${icon("key")}
        <h2>${view.personName}'s bot token</h2>
      </div>
    </div>
    <div class="card-body stack">
      <div class="copy-field token-field">
        <code class="mono">${view.token}</code>
        <button
          type="button"
          class="btn btn-sm btn-primary"
          data-copy="${view.token}"
          aria-label="Copy token"
        >
          ${icon("copy")}<span>Copy</span>
        </button>
      </div>
      <p class="faint">${accountsLine(view)}</p>
    </div>
  </section>`;
}

function connector(view: TokenView): Html {
  return html`<section class="card">
    <div class="card-head">
      <div class="stack">
        <h2>Connector settings</h2>
        <p>In the bot's Grok settings, add a custom MCP connector with these values.</p>
      </div>
    </div>
    <div class="card-body">
      <dl class="settings">
        <dt>Name</dt>
        <dd>${copyField(view.connectorName, "connector name")}</dd>
        <dt>Server URL</dt>
        <dd>${copyField(view.mcpUrl, "server URL")}</dd>
        <dt>Header name</dt>
        <dd>${copyField("Authorization", "header name")}</dd>
        <dt>Header value</dt>
        <dd>${copyField(view.authorization, "header value")}</dd>
      </dl>
    </div>
  </section>`;
}

function prompt(view: TokenView): Html {
  return html`<section class="card">
    <div class="card-head">
      <div class="stack">
        <h2>Setup prompt</h2>
        <p>
          Paste it into ${view.personName}'s bot once the connector is set. It lists their accounts
          and never contains the token.
        </p>
      </div>
      <button
        type="button"
        class="btn btn-sm"
        data-copy="${view.prompt}"
        aria-label="Copy setup prompt"
      >
        ${icon("copy")}<span>Copy setup prompt</span>
      </button>
    </div>
    <div class="card-body">
      <label class="visually-hidden" for="setup-prompt">Setup prompt</label>
      <textarea id="setup-prompt" class="prompt" readonly rows="14">${view.prompt}</textarea>
    </div>
  </section>`;
}

/**
 * The one-time token panel (GROKCHAT-16), rendered only as the answer to the POST that made the
 * token: no URL, redirect, log or audit line ever holds it, the response is `no-store`, and
 * `hx-history="false"` keeps htmx from snapshotting the page.
 */
export function tokenPage(panel: TokenPanel, frame: PageFrame): Html {
  return panel.kind === "issued" ? issuedPage(panel.view, frame) : stalePage(panel.view, frame);
}

/**
 * A re-sent token form (a reload, GROKCHAT-18): nothing was rotated. Rotating again is a fresh,
 * deliberate press, whose form names the token the person has now.
 */
function stalePage(view: StaleTokenView, frame: PageFrame): Html {
  const action = `/dashboard/people/${encodeURIComponent(view.personId)}/token`;
  return shell(
    {
      title: `Token already issued for ${view.personName}`,
      subtitle: "Nothing was changed",
      tools: html`<a class="btn" href="/dashboard/accounts">${icon("back")}<span>Back</span></a>`,
      body: html`<section class="card token-page" hx-history="false">
        <div class="card-body stack">
          <p class="callout warning" role="alert">
            ${icon("warning")}
            <span>
              <strong>This token was already issued.</strong> The page was reloaded or the form
              sent twice, so the token was not rotated again. ${view.personName}: ${view.current}.
              If you missed copying it, rotate again: the current token then stops working.
            </span>
          </p>
          <form method="post" action="${action}" hx-boost="false" class="inline-form">
            ${csrfField(frame.csrf)}<input type="hidden" name="issued" value="${view.issued}" />
            <button class="btn btn-primary btn-sm">
              ${icon("key")}<span>Rotate again</span>
            </button>
          </form>
        </div>
      </section>`,
    },
    frame,
  );
}

function issuedPage(view: TokenView, frame: PageFrame): Html {
  const title = `${view.rotated ? "New token" : "Token"} for ${view.personName}`;
  return shell(
    {
      title,
      subtitle: "Shown once: copy it now",
      tools: html`<a class="btn" href="/dashboard/accounts">${icon("back")}<span>Done</span></a>`,
      body: html`<div class="token-page" hx-history="false">
        <p class="callout warning" role="alert">
          ${icon("warning")}
          <span>
            <strong>This token is shown once.</strong> GrokChat keeps only its hash: leave or reload
            this page and it is gone (you can rotate it to get a new one).
            ${view.rotated ? html`<strong>The previous token has stopped working.</strong>` : ""}
          </span>
        </p>
        ${tokenCard(view)} ${connector(view)} ${prompt(view)}
      </div>`,
    },
    frame,
  );
}

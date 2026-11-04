import { html } from "hono/html";
import type { ActivityView } from "../../../interface_adapters/dashboard/activity_controller";
import type { ActivityRow } from "../../../interface_adapters/dashboard/activity_views";
import type { PageFrame } from "../respond";
import { chip, empty, pager, select, who } from "./components";
import { shell, type Html } from "./layout";

const ACTOR_TONE = { bot: "info", human: "good", system: "neutral" } as const;

function row(entry: ActivityRow): Html {
  const tone = entry.actor.kind === null ? "neutral" : ACTOR_TONE[entry.actor.kind];
  return html`<tr>
    <td class="cell-when">
      <span class="time">${entry.relative}<small>${entry.when}</small></span>
    </td>
    <td class="cell-who">
      <span class="chip plain ${tone}">${entry.actor.kind ?? "other"}</span>
      <span class="mono">${entry.actor.name}</span>
    </td>
    <td class="cell-main">
      ${chip(entry.action)}${entry.detail === "" ? "" : html`<div class="faint mono">${entry.detail}</div>`}
    </td>
    <td class="cell-account">
      ${entry.account === null ? html`<span class="faint">—</span>` : who(entry.account)}
    </td>
    <td class="cell-post">
      ${entry.postHref === null ? "" : html`<a href="${entry.postHref}">Post</a>`}
    </td>
    <td class="num cell-cost">${entry.cost}</td>
  </tr>`;
}

function filters(view: ActivityView): Html {
  const accounts = view.accounts.map((account) => ({
    value: account.id,
    label: account.handle,
    selected: account.selected,
  }));
  return html`<form class="card filters" method="get" action="/dashboard/activity" data-autosubmit>
    ${select("account", accounts, "All accounts", "Account")}
    ${select("actor", view.actors, "Anyone", "Who")}
    ${select("kind", view.kinds, "Everything", "What")}
    <button class="btn js-hide">Apply</button>
    ${view.filtered ? html`<a class="btn btn-ghost" href="/dashboard/activity">Clear filters</a>` : ""}
  </form>`;
}

function table(view: ActivityView): Html {
  if (view.rows.length === 0) {
    return empty(
      "activity",
      "Nothing here yet",
      "Every request (from a bot, from you, or from GrokChat itself) is recorded here, with what X charged for it.",
    );
  }
  return html`<div class="table-wrap">
      <table class="table table-activity stack-sm">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>What</th>
            <th>Account</th>
            <th><span class="visually-hidden">Post</span></th>
            <th class="num">Cost</th>
          </tr>
        </thead>
        <tbody>
          ${view.rows.map(row)}
        </tbody>
      </table>
    </div>
    ${pager(view, "events")}`;
}

export function activityPage(view: ActivityView, frame: PageFrame): Html {
  return shell(
    {
      title: "Activity",
      subtitle: "Every request: what bots, you and GrokChat did, and what it cost",
      body: html`${filters(view)}
        <section class="card">${table(view)}</section>`,
    },
    frame,
  );
}

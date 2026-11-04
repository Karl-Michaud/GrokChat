import { html } from "hono/html";
import type { AnalyticsView } from "../../../interface_adapters/dashboard/analytics_controller";
import type { AccountRow, TopPostRow } from "../../../interface_adapters/dashboard/analytics_views";
import type { MediaMeter } from "../../../interface_adapters/dashboard/media_views";
import type { PageFrame } from "../respond";
import { barList, lineChartView, meterBar } from "./charts";
import { card, empty, externalLink, kpiStat, kpiTile, segmented, tabs, who } from "./components";
import { shell, type Html } from "./layout";

function accountsTable(rows: readonly AccountRow[]): Html {
  return html`<div class="table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th>Account</th>
          <th class="num">Impressions</th>
          <th class="num">Engagements</th>
          <th class="num hide-sm">Rate</th>
          <th class="num">Posts</th>
          <th class="num">Followers</th>
          <th class="num hide-sm">Growth</th>
          <th class="num hide-sm">X spend</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(
          (row) =>
            html`<tr>
              <td><a href="${row.href}">${who(row.account)}</a></td>
              <td class="num">${row.impressions}</td>
              <td class="num">${row.engagements}</td>
              <td class="num hide-sm">${row.rate}</td>
              <td class="num">${row.published}</td>
              <td class="num">${row.followers}</td>
              <td class="num hide-sm">${row.growth}</td>
              <td class="num hide-sm">${row.spend}</td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

function topPosts(rows: readonly TopPostRow[]): Html {
  if (rows.length === 0) {
    return empty(
      "posts",
      "No post gained anything in this range",
      "Published posts show here once X reports their metrics.",
    );
  }
  return html`<div class="table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th>Post</th>
          <th class="hide-sm">Account</th>
          <th class="num">Impressions</th>
          <th class="num">Engagements</th>
          <th class="num hide-sm">Rate</th>
          <th class="hide-sm"><span class="visually-hidden">On X</span></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(
          (row) =>
            html`<tr>
              <td><a class="cell-text" href="${row.href}">${row.text}</a></td>
              <td class="hide-sm">${who(row.account)}</td>
              <td class="num">${row.impressions}</td>
              <td class="num">${row.engagements}</td>
              <td class="num hide-sm">${row.rate}</td>
              <td class="hide-sm">${externalLink(row.xUrl, "X")}</td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

function meters(rows: readonly MediaMeter[], month: string): Html {
  if (rows.length === 0) {
    return html`<p class="muted">R2 usage is not available.</p>`;
  }
  return html`<ul class="bars">
      ${rows.map(
        (row) =>
          html`<li title="Uploads stop at ${row.guard}, inside the free allowance">
            <span>${row.name}</span><span class="num faint">${row.used}</span>${meterBar(row)}
          </li>`,
      )}
    </ul>
    <p class="faint">
      ${month === "" ? "" : `Month ${month} · uploads stop before the free allowance`}
    </p>`;
}

function spend(view: AnalyticsView): Html {
  return html`<div class="stack">
    <div>
      <div class="big-number">${view.spend.total}</div>
      <p class="faint">
        ${view.spend.calls} X
        calls${view.spend.unknownPriced > 0 ? `, ${String(view.spend.unknownPriced)} unpriced (media uploads)` : ""}
      </p>
    </div>
    ${view.spendByAccount.length > 1 ? barList(view.spendByAccount) : ""}
  </div>`;
}

function followers(view: AnalyticsView): Html {
  return html`<div class="stack">
    <div class="row">
      <span class="big-number">${view.followersNow}</span>
      <span class="delta">${view.followerGrowth} in range</span>
    </div>
    ${lineChartView(view.followers, "Followers", "short")}
  </div>`;
}

function body(view: AnalyticsView): Html {
  const scope = view.account === null ? "All accounts" : view.account.handle;
  return html`<div class="kpis">
      ${view.kpis.headline.map((kpi) => kpiTile(kpi, view.compared))}
    </div>
    <div class="card kpi-strip">
      ${view.kpis.secondary.map((kpi) => kpiStat(kpi, view.compared))}
    </div>
    ${card(view.metricLabel, `${scope} · ${view.rangeLabel}`, lineChartView(view.chart, view.metricLabel), tabs(view.metrics, "Metric"))}
    <div class="grid-2">
      ${card("Followers", "Summed over the accounts, read once a day", followers(view))}
      ${card(`${view.metricLabel} by account`, view.rangeLabel, view.comparison.length === 0 ? html`<p class="muted">No account yet.</p>` : barList(view.comparison))}
    </div>
    <section class="card">
      <div class="card-head"><h2>Accounts</h2></div>
      <div class="card-body flush">
        ${view.accountRows.length === 0 ? empty("accounts", "No account connected", "Connect an X account to start.", html`<a class="btn btn-primary" href="/dashboard/accounts">Go to accounts</a>`) : accountsTable(view.accountRows)}
      </div>
    </section>
    <section class="card">
      <div class="card-head">
        <h2>Top posts</h2>
        <p>By engagements gained in the range</p>
      </div>
      <div class="card-body flush">${topPosts(view.topPosts)}</div>
    </section>
    <div class="grid-halves">
      ${card("X API spend", view.rangeLabel, spend(view))}
      ${card("Media storage (R2)", "Against the free allowance", meters(view.media, view.mediaMonth))}
    </div>`;
}

export function analyticsPage(view: AnalyticsView, frame: PageFrame): Html {
  const keep = { range: view.range, metric: view.metric };
  return shell(
    {
      title: "Analytics",
      subtitle: `${view.account === null ? "All accounts" : view.account.handle} · ${view.rangeLabel}`,
      tools: segmented(view.ranges, "Range"),
      switcher: { accounts: view.accounts, keep },
      body: body(view),
    },
    frame,
  );
}

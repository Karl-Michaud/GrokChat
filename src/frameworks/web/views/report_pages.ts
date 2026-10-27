import { html } from "hono/html";
import type {
  AuditView,
  CostsView,
  MediaView,
  MetricsView,
} from "../../../interface_adapters/dashboard/reports_controller";
import type { CostRow } from "../../../interface_adapters/dashboard/report_views";
import { layout, select, type Html } from "./layout";

const options = (view: { readonly accounts: MetricsView["accounts"] }) =>
  view.accounts.map((a) => ({ value: a.id, label: a.handle, selected: a.selected }));

export function metricsPage(view: MetricsView, csrf: string): Html {
  return layout(
    "Metrics",
    csrf,
    html`<form method="get" action="/dashboard/metrics">
        ${select("account", options(view), null)}
        <label>Days <input name="days" value="${view.days}" size="3" /></label>
        <button>Show</button>
      </form>
      ${
        view.account === null
          ? html`<p>No accounts yet.</p>`
          : html`<p>
                ${view.account}: ${view.posts} posts read in the last ${view.days} days
                (${view.snapshots} snapshots).
              </p>
              <table border="1">
                ${view.totals.map(
                  (total) =>
                    html`<tr>
                      <th>${total.name}</th>
                      <td>${total.value}</td>
                    </tr>`,
                )}
              </table>`
      }`,
  );
}

function costLine(row: CostRow): Html {
  return html`<tr>
    <td>${row.label}</td>
    <td>${row.usd}</td>
    <td>${row.calls}</td>
    <td>${row.unknownPriced}</td>
  </tr>`;
}

export function costsPage(view: CostsView, csrf: string): Html {
  return layout(
    "Costs",
    csrf,
    html`<form method="get" action="/dashboard/costs">
        <label>Days <input name="days" value="${view.days}" size="3" /></label><button>Show</button>
      </form>
      <p>
        Estimated X API cost over the last ${view.days} days. Calls with no listed price are
        counted, not priced.
      </p>
      <table border="1">
        <tr>
          <th>Account</th>
          <th>Estimate</th>
          <th>Calls</th>
          <th>Unpriced calls</th>
        </tr>
        ${costLine(view.total)} ${view.accounts.map(costLine)}
      </table>`,
  );
}

export function mediaPage(view: MediaView, csrf: string): Html {
  return layout(
    "Media (R2)",
    csrf,
    html`<p>R2 use for ${view.month} against the free allowance. Uploads stop at the guard.</p>
      <table border="1">
        <tr>
          <th></th>
          <th>Used</th>
          <th>Guard</th>
          <th>Free allowance</th>
          <th>Of allowance</th>
        </tr>
        ${view.rows.map(
          (row) =>
            html`<tr>
              <th>${row.name}</th>
              <td>${row.used}${row.atGuard ? html` <strong>at the guard</strong>` : ""}</td>
              <td>${row.guard}</td>
              <td>${row.allowance}</td>
              <td>${row.percent}</td>
            </tr>`,
        )}
      </table>`,
  );
}

export function auditPage(view: AuditView, csrf: string): Html {
  return layout(
    "Audit",
    csrf,
    html`<form method="get" action="/dashboard/audit">
        ${select("account", options(view), "Every account")}
        <label>Limit <input name="limit" value="${view.limit}" size="4" /></label
        ><button>Show</button>
      </form>
      <table border="1">
        <tr>
          <th>At</th>
          <th>Actor</th>
          <th>Action</th>
          <th>Account</th>
          <th>Post</th>
          <th>Detail</th>
        </tr>
        ${view.events.map(
          (event) =>
            html`<tr>
              <td>${event.at}</td>
              <td>${event.actor}</td>
              <td>${event.action}</td>
              <td>${event.account}</td>
              <td>
                ${event.postHref === null ? "" : html`<a href="${event.postHref}">${event.postId}</a>`}
              </td>
              <td>${event.detail}</td>
            </tr>`,
        )}
      </table>`,
  );
}

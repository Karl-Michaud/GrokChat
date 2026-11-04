import { html } from "hono/html";
import {
  SORT_LABELS,
  type PostListRow,
  type SortColumn,
} from "../../../interface_adapters/dashboard/post_list_views";
import type { PostsView } from "../../../interface_adapters/dashboard/posts_controller";
import type { PageFrame } from "../respond";
import { chip, empty, externalLink, pager, select, who } from "./components";
import { shell, type Html } from "./layout";

const ARROW = { asc: " ↑", desc: " ↓" } as const;
const ARIA = { asc: "ascending", desc: "descending" } as const;

function header(column: SortColumn): Html {
  return html`<th class="${column.key === "time" ? "" : "num"}">
    <a
      href="${column.href}"
      ${column.sorted === null ? "" : html`aria-sort="${ARIA[column.sorted]}"`}
      >${column.label}${column.sorted === null ? "" : ARROW[column.sorted]}</a
    >
  </th>`;
}

const METRICS = [
  "impressions",
  "engagements",
  "likes",
  "reposts",
  "replies",
  "linkClicks",
] as const;

/**
 * One post. The account, the thread length and the link to X sit under the text in small muted
 * type, so the metrics fit beside it; on a phone the row is a card (the cells carry their labels).
 */
function row(post: PostListRow): Html {
  const unread = METRICS.every((key) => post.metrics[key] === "—");
  return html`<tr class="${unread ? "is-unread" : ""}">
    <td class="cell-main">
      <a class="cell-text" href="${post.href}">${post.text}</a>
      <span class="cell-meta"
        >${who(post.account)}${post.parts > 1 ? html`<span>${String(post.parts)}-part thread</span>` : ""}${post.xUrl === null ? "" : externalLink(post.xUrl, "On X")}</span
      >
    </td>
    <td class="cell-status">${chip(post.status)}</td>
    <td class="cell-time">
      <span class="time">${post.when}<small>${post.relative}</small></span>
    </td>
    ${METRICS.map((key) => html`<td class="num cell-metric" data-label="${SORT_LABELS[key]}">${post.metrics[key]}</td>`)}
  </tr>`;
}

function filters(view: PostsView): Html {
  const accounts = view.accounts.map((account) => ({
    value: account.id,
    label: account.handle,
    selected: account.selected,
  }));
  const statuses = view.statuses.map((status) => ({
    value: status.value,
    label: status.label,
    selected: status.selected,
  }));
  const sorted = view.columns.find((column) => column.sorted !== null);
  return html`<form class="card filters" method="get" action="/dashboard/posts" data-autosubmit>
    ${select("account", accounts, "All accounts", "Account")}
    ${select("status", statuses, "Any status", "Status")}
    <label>From <input type="date" name="from" value="${view.from}" /></label>
    <label>To <input type="date" name="to" value="${view.to}" /></label>
    ${sorted === undefined ? "" : html`<input type="hidden" name="sort" value="${sorted.key}" /><input type="hidden" name="dir" value="${sorted.sorted ?? "desc"}" />`}
    <button class="btn js-hide">Apply</button>
    ${view.filtered ? html`<a class="btn btn-ghost" href="${view.clearHref}">Clear filters</a>` : ""}
  </form>`;
}

function table(view: PostsView): Html {
  if (view.rows.length === 0) {
    return empty(
      "posts",
      view.filtered ? "No post matches these filters" : "No posts yet",
      view.filtered
        ? "Try another account, status or date."
        : "Posts appear here as soon as a Grok bot creates one through the MCP server.",
      view.filtered ? html`<a class="btn" href="${view.clearHref}">Clear filters</a>` : "",
    );
  }
  const [time, ...metrics] = view.columns;
  return html`<div class="table-wrap">
      <table class="table table-posts stack-sm">
        <thead>
          <tr>
            <th class="col-post">Post</th>
            <th>Status</th>
            ${time === undefined ? "" : header(time)} ${metrics.map(header)}
          </tr>
        </thead>
        <tbody>
          ${view.rows.map(row)}
        </tbody>
      </table>
    </div>
    ${pager(view, "posts")}`;
}

export function postsPage(view: PostsView, frame: PageFrame): Html {
  return shell(
    {
      title: "Posts",
      subtitle: "Every post, with its metrics on X",
      body: html`${filters(view)}
        <section class="card">${table(view)}</section>`,
    },
    frame,
  );
}

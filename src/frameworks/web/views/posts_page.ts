import { html } from "hono/html";
import type {
  PostListRow,
  SortColumn,
} from "../../../interface_adapters/dashboard/post_list_views";
import type { PostsView } from "../../../interface_adapters/dashboard/posts_controller";
import type { PageFrame } from "../respond";
import { chip, empty, externalLink, pager, select, who } from "./components";
import { shell, type Html } from "./layout";

const ARROW = { asc: " ↑", desc: " ↓" } as const;
const ARIA = { asc: "ascending", desc: "descending" } as const;

function header(column: SortColumn): Html {
  const numeric = column.key !== "time";
  return html`<th
    class="${numeric ? "num" : ""} ${column.key === "replies" || column.key === "reposts" || column.key === "linkClicks" ? "hide-sm" : ""}"
  >
    <a
      href="${column.href}"
      ${column.sorted === null ? "" : html`aria-sort="${ARIA[column.sorted]}"`}
      >${column.label}${column.sorted === null ? "" : ARROW[column.sorted]}</a
    >
  </th>`;
}

function row(post: PostListRow): Html {
  return html`<tr>
    <td>
      <div class="stack">
        <a class="cell-text" href="${post.href}">${post.text}</a>
        <span class="row faint"
          >${post.parts > 1 ? html`<span>${String(post.parts)}-part thread</span>` : ""}${post.xUrl === null ? "" : externalLink(post.xUrl, "View on X")}</span
        >
      </div>
    </td>
    <td class="hide-sm">${who(post.account)}</td>
    <td>${chip(post.status)}</td>
    <td>
      <span class="time">${post.when}<small>${post.relative}</small></span>
    </td>
    <td class="num">${post.metrics.impressions}</td>
    <td class="num">${post.metrics.engagements}</td>
    <td class="num">${post.metrics.likes}</td>
    <td class="num hide-sm">${post.metrics.reposts}</td>
    <td class="num hide-sm">${post.metrics.replies}</td>
    <td class="num hide-sm">${post.metrics.linkClicks}</td>
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
      <table class="table">
        <thead>
          <tr>
            <th class="col-post">Post</th>
            <th class="hide-sm">Account</th>
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

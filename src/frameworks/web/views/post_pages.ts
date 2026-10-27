import { html } from "hono/html";
import type {
  BacklogView,
  CalendarView,
} from "../../../interface_adapters/dashboard/post_pages_controller";
import type { PostDetailView, PostRow } from "../../../interface_adapters/dashboard/post_views";
import { button, csrfField, layout, select, type Html } from "./layout";

function rows(posts: readonly PostRow[]): Html {
  return html`<table border="1">
    <tr>
      <th>Publish at</th>
      <th>Account</th>
      <th>Status</th>
      <th>Parts</th>
      <th>Text</th>
    </tr>
    ${posts.map(
      (post) =>
        html`<tr>
          <td><a href="${post.href}">${post.publishAt}</a></td>
          <td>${post.account}</td>
          <td>${post.status}</td>
          <td>${post.parts}</td>
          <td>${post.text}</td>
        </tr>`,
    )}
  </table>`;
}

export function backlogPage(view: BacklogView, csrf: string): Html {
  const accounts = view.accounts.map((a) => ({
    value: a.id,
    label: a.handle,
    selected: a.selected,
  }));
  const statuses = view.statuses.map((s) => ({
    value: s.value,
    label: s.value,
    selected: s.selected,
  }));
  return layout(
    "Backlog",
    csrf,
    html`<form method="get" action="/dashboard/backlog">
        ${select("account", accounts, "Every account")}
        ${select("status", statuses, "Every status")}
        <button>Filter</button>
      </form>
      ${view.rows.length === 0 ? html`<p>No posts.</p>` : rows(view.rows)}`,
  );
}

export function calendarPage(view: CalendarView, csrf: string): Html {
  return layout(
    `Week of ${view.start} (UTC)`,
    csrf,
    html`<p>
        <a href="/dashboard/calendar?start=${view.previous}">Previous week</a>
        <a href="/dashboard/calendar?start=${view.next}">Next week</a>
      </p>
      ${view.days.map(
        (day) =>
          html`<section>
            <h2>${day.weekday} ${day.date}</h2>
            ${
              day.posts.length === 0
                ? html`<p>Nothing.</p>`
                : html`<ul>
                    ${day.posts.map(
                      (post) =>
                        html`<li>
                          <a href="${post.href}">${post.time}</a> ${post.account} ${post.status}:
                          ${post.text}
                        </li>`,
                    )}
                  </ul>`
            }
          </section>`,
      )}`,
  );
}

function editForm(view: PostDetailView, csrf: string): Html {
  return html`<h2>Edit</h2>
    <form method="post" action="/dashboard/posts/${encodeURIComponent(view.id)}/edit">
      ${csrfField(csrf)}
      ${view.parts.map(
        (part) =>
          html`<p>
            <label
              >Part ${part.number}<br /><textarea name="text" rows="4" cols="60">
${part.text}</textarea>
            </label>
            <input type="hidden" name="media" value="${part.media}" />
          </p>`,
      )}
      <label
        >Publish at (UTC)
        <input type="datetime-local" name="publishAt" value="${view.publishAtInput}"
      /></label>
      <button>Save</button>
    </form>`;
}

function rescheduleForm(view: PostDetailView, csrf: string): Html {
  return html`<h2>Reschedule</h2>
    <form method="post" action="/dashboard/posts/${encodeURIComponent(view.id)}/reschedule">
      ${csrfField(csrf)}
      <label>Publish at (UTC) <input type="datetime-local" name="publishAt" required /></label>
      ${
        view.actions.confirmNotOnX
          ? html`<label
              ><input type="checkbox" name="confirmedNotOnX" value="yes" /> I checked X: the post is
              not there</label
            >`
          : ""
      }
      <button>Reschedule</button>
    </form>`;
}

function actions(view: PostDetailView, csrf: string): Html {
  const base = `/dashboard/posts/${encodeURIComponent(view.id)}`;
  const offered = view.actions;
  return html`${offered.approve ? button(`${base}/approve`, "Approve", csrf) : ""}
  ${offered.reject ? button(`${base}/reject`, "Reject", csrf) : ""}
  ${offered.cancel ? button(`${base}/cancel`, "Cancel", csrf) : ""}
  ${offered.delete ? button(`${base}/delete`, "Delete on X", csrf) : ""}
  ${offered.edit ? editForm(view, csrf) : ""}
  ${offered.reschedule ? rescheduleForm(view, csrf) : ""}`;
}

function metricsTable(view: PostDetailView): Html {
  if (view.metrics.length === 0) {
    return html`<p>None yet.</p>`;
  }
  return html`<table border="1">
    <tr>
      <th>Part</th>
      <th>Read at</th>
      <th>Impressions</th>
      <th>Likes</th>
      <th>Reposts</th>
      <th>Replies</th>
      <th>Quotes</th>
      <th>Bookmarks</th>
    </tr>
    ${view.metrics.map(
      (row) =>
        html`<tr>
          <td>${row.xPostId}</td>
          <td>${row.takenAt}</td>
          <td>${row.impressions}</td>
          <td>${row.likes}</td>
          <td>${row.reposts}</td>
          <td>${row.replies}</td>
          <td>${row.quotes}</td>
          <td>${row.bookmarks}</td>
        </tr>`,
    )}
  </table>`;
}

function facts(view: PostDetailView): Html {
  return html`<dl>
      <dt>Account</dt>
      <dd>${view.account}</dd>
      <dt>Status</dt>
      <dd>${view.status} (${view.lifecycle}, version ${view.version})</dd>
      <dt>Publish at</dt>
      <dd>${view.publishAt}</dd>
      ${
        view.resumeAt === null
          ? ""
          : html`<dt>Resumes at</dt>
              <dd>${view.resumeAt}</dd>`
      }
      <dt>Created by</dt>
      <dd>${view.createdBy}</dd>
    </dl>
    <ol>
      ${view.parts.map(
        (part) =>
          html`<li>
            ${part.text} [${part.state}${part.xPostId === null ? "" : html` ${part.xPostId}`}]
          </li>`,
      )}
    </ol>`;
}

export function postPage(view: PostDetailView, csrf: string): Html {
  return layout(
    `Post ${view.id}`,
    csrf,
    html`${facts(view)} ${actions(view, csrf)}
      <h2>Metrics</h2>
      ${metricsTable(view)}`,
  );
}

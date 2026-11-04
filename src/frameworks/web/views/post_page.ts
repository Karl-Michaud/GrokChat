import { html } from "hono/html";
import type { ActivityRow } from "../../../interface_adapters/dashboard/activity_views";
import type { PostDetailView } from "../../../interface_adapters/dashboard/post_views";
import type { PageFrame } from "../respond";
import { lineChartView } from "./charts";
import { card, chip, csrfField, empty, externalLink, postButton, who } from "./components";
import { icon } from "./icons";
import { shell, type Html } from "./layout";

function thread(view: PostDetailView): Html {
  return html`<ol class="thread">
    ${view.parts.map(
      (part) =>
        html`<li>
          <span class="avatar t${String(view.account.tone)}" aria-hidden="true"
            >${String(part.number)}</span
          >
          <div class="stack">
            <p class="thread-text">${part.text}</p>
            <span class="row faint">
              ${chip(part.state)} ${part.xUrl === null ? "" : externalLink(part.xUrl, "View on X")}
            </span>
          </div>
        </li>`,
    )}
  </ol>`;
}

function facts(view: PostDetailView): Html {
  return html`<dl class="facts">
    <dt>Account</dt>
    <dd>${who(view.account)}</dd>
    <dt>Status</dt>
    <dd>${chip(view.status)}</dd>
    <dt>Publish at</dt>
    <dd>${view.publishAt} <span class="faint">(${view.publishRelative})</span></dd>
    ${
      view.resumeAt === null
        ? ""
        : html`<dt>Resumes at</dt>
            <dd>${view.resumeAt}</dd>`
    }
    ${
      view.replyToUrl === null
        ? ""
        : html`<dt>Reply to</dt>
            <dd>${externalLink(view.replyToUrl, "Post on X")}</dd>`
    }
    <dt>Created by</dt>
    <dd class="mono">${view.createdBy}</dd>
    <dt>State</dt>
    <dd class="mono">${view.lifecycle} · v${String(view.version)}</dd>
    <dt>Post id</dt>
    <dd class="mono">${view.id}</dd>
  </dl>`;
}

function editForm(view: PostDetailView, csrf: string, base: string): Html {
  return html`<details class="disclose">
    <summary>Edit</summary>
    <form method="post" action="${base}/edit" class="stack">
      ${csrfField(csrf)}
      ${view.parts.map(
        (part) =>
          html`<label
              >Part ${String(part.number)}<textarea name="text" rows="3">
${part.text}</textarea></label
            ><input type="hidden" name="media" value="${part.media}" />`,
      )}
      <label
        >Publish at (UTC)
        <input type="datetime-local" name="publishAt" value="${view.publishAtInput}"
      /></label>
      <button class="btn btn-primary">Save changes</button>
    </form>
  </details>`;
}

function rescheduleForm(view: PostDetailView, csrf: string, base: string): Html {
  return html`<details class="disclose" open>
    <summary>Reschedule</summary>
    <form method="post" action="${base}/reschedule" class="stack">
      ${csrfField(csrf)}
      <label>Publish at (UTC) <input type="datetime-local" name="publishAt" required /></label>
      ${view.actions.confirmNotOnX ? html`<label class="check"><input type="checkbox" name="confirmedNotOnX" value="yes" /> I checked X: the post is not there</label>` : ""}
      <button class="btn btn-primary">Reschedule</button>
    </form>
  </details>`;
}

function actions(view: PostDetailView, csrf: string): Html {
  const base = `/dashboard/posts/${encodeURIComponent(view.id)}`;
  const offered = view.actions;
  const buttons = html`${offered.approve ? postButton(`${base}/approve`, "Approve", csrf, "btn btn-primary") : ""}
  ${offered.reject ? postButton(`${base}/reject`, "Reject", csrf) : ""}
  ${offered.cancel ? postButton(`${base}/cancel`, "Cancel post", csrf) : ""}
  ${offered.delete ? postButton(`${base}/delete`, "Delete on X", csrf, "btn btn-danger") : ""}`;
  const any =
    offered.approve ||
    offered.reject ||
    offered.cancel ||
    offered.delete ||
    offered.edit ||
    offered.reschedule;
  return any
    ? html`<div class="stack">
        <div class="actions">${buttons}</div>
        ${offered.edit ? editForm(view, csrf, base) : ""}
        ${offered.reschedule ? rescheduleForm(view, csrf, base) : ""}
      </div>`
    : html`<p class="muted">Nothing to do: this post is ${view.status.label.toLowerCase()}.</p>`;
}

function timeline(rows: readonly ActivityRow[]): Html {
  if (rows.length === 0) {
    return html`<p class="muted">No history yet.</p>`;
  }
  return html`<ol class="timeline">
    ${rows.map(
      (row) =>
        html`<li>
          <span class="row"
            >${chip(row.action)}${row.cost === "" ? "" : html`<span class="faint num">${row.cost}</span>`}</span
          >
          <small
            >${row.when} ·
            ${row.actor.name}${row.detail === "" ? "" : html` · <span class="mono">${row.detail}</span>`}</small
          >
        </li>`,
    )}
  </ol>`;
}

function metrics(view: PostDetailView): Html {
  if (view.reads === 0) {
    return empty(
      "analytics",
      "No metrics yet",
      "X has not been read for this post yet. Metrics arrive within the hour after it publishes.",
    );
  }
  const t = view.totals;
  return html`<div class="stack">
    <div class="mini-metrics">
      <div><strong>${t.impressions}</strong><span>Impressions</span></div>
      <div><strong>${t.engagements}</strong><span>Engagements</span></div>
      <div><strong>${t.likes}</strong><span>Likes</span></div>
      <div><strong>${t.reposts}</strong><span>Reposts</span></div>
      <div><strong>${t.replies}</strong><span>Replies</span></div>
      <div><strong>${t.linkClicks}</strong><span>Link clicks</span></div>
    </div>
    ${lineChartView(view.chart, "Impressions", "short")}
  </div>`;
}

export function postPage(view: PostDetailView, frame: PageFrame): Html {
  return shell(
    {
      title: view.parts.length > 1 ? `Thread of ${String(view.parts.length)}` : "Post",
      subtitle: `${view.account.handle} · ${view.publishAt}`,
      tools: html`<a class="btn" href="/dashboard/posts">${icon("back")}All posts</a>`,
      body: html`<div class="grid-2">
        <div class="stack">
          ${card("Text", null, thread(view))}
          ${card("Metrics on X", view.reads === 0 ? null : `${String(view.reads)} reads, newest per part`, metrics(view))}
        </div>
        <div class="stack">
          ${card("Details", null, facts(view))} ${card("Actions", null, actions(view, frame.csrf))}
          ${card("History", "Every request about this post", timeline(view.timeline))}
        </div>
      </div>`,
    },
    frame,
  );
}

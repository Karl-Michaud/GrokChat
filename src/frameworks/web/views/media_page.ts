import { html } from "hono/html";
import type {
  MediaItemView,
  MediaPageView,
  MediaSection,
} from "../../../interface_adapters/dashboard/media_controller";
import { MEDIA_PAGE } from "../../../interface_adapters/dashboard/media_controller";
import type { PageFrame } from "../respond";
import { chip, copyField, csrfField, empty, who } from "./components";
import { icon } from "./icons";
import { shell, type Html } from "./layout";

/** The account select: one optgroup per person, then Unassigned. */
function accountSelect(view: MediaPageView): Html {
  return html`<label
    >Account
    <select name="account" required>
      ${view.groups.map(
        (group) =>
          html`<optgroup label="${group.label}">
            ${group.options.map(
              (option) =>
                html`<option value="${option.value}" ${option.selected ? "selected" : ""}>
                  ${option.label}
                </option>`,
            )}
          </optgroup>`,
      )}
    </select></label
  >`;
}

/** The label and the file: the label is optional, the type is checked by its bytes. */
function fileFields(view: MediaPageView): Html {
  return html`<label
      >Label
      <input
        name="label"
        maxlength="${String(view.maxLabel)}"
        placeholder="e.g. launch banner"
        autocomplete="off"
    /></label>
    <label class="upload-file"
      >File <input type="file" name="file" accept="${view.accept}" required
    /></label>`;
}

/**
 * The upload form (GROKCHAT-18): a plain multipart POST with the CSRF field, so it works with no
 * script; htmx is off for it (`hx-boost="false"`), so the browser sends the file itself.
 */
function uploadCard(view: MediaPageView, csrf: string): Html {
  if (view.groups.length === 0) {
    return "";
  }
  return html`<section class="card">
    <div class="card-head">
      <div class="stack">
        <h2>Upload an image</h2>
        <p>
          PNG, JPEG, WebP or GIF: photos up to 5 MB, GIFs up to 15 MB. The account's bot finds it
          with <code>list_media</code>.
        </p>
      </div>
    </div>
    <div class="card-body">
      <form
        class="upload-form"
        method="post"
        action="${MEDIA_PAGE}"
        enctype="multipart/form-data"
        hx-boost="false"
      >
        ${csrfField(csrf)} ${accountSelect(view)} ${fileFields(view)}
        <div class="upload-submit">
          <button class="btn btn-primary">${icon("upload")}<span>Upload</span></button>
        </div>
      </form>
    </div>
  </section>`;
}

function uploadedNotice(view: MediaPageView): Html {
  if (view.uploaded === null) {
    return "";
  }
  return html`<div class="callout good media-notice" role="status">
    ${icon("check")}
    <div class="stack">
      <span
        ><strong>Uploaded.</strong> Tell the bot it is on the Media page, or give it this
        media_id:</span
      >
      ${copyField(view.uploaded, "media_id")}
    </div>
  </div>`;
}

function deleteControl(item: MediaItemView, csrf: string): Html {
  if (!item.canDelete) {
    return "";
  }
  return html`<details class="pop">
    <summary class="btn btn-sm btn-ghost btn-danger">Delete</summary>
    <div class="pop-body">
      <form
        method="post"
        action="${MEDIA_PAGE}/${encodeURIComponent(item.id)}/delete"
        class="stack"
      >
        ${csrfField(csrf)}
        <p>No post uses it. Delete <strong>${item.label}</strong> from GrokChat's storage?</p>
        <div><button class="btn btn-sm btn-danger">Delete</button></div>
      </form>
    </div>
  </details>`;
}

function tile(item: MediaItemView, csrf: string): Html {
  return html`<li class="media-tile">
    <a class="media-thumb" href="${item.fileUrl}" target="_blank" rel="noopener"
      ><img
        src="${item.fileUrl}"
        alt="${item.labelled ? item.label : "Untitled image"}"
        loading="lazy"
    /></a>
    <div class="media-info">
      <div class="media-title">
        <strong class="${item.labelled ? "" : "faint"}">${item.label}</strong>${chip(item.status)}
      </div>
      <p class="media-meta">
        <span>${item.type} · ${item.size}</span><span>${item.uploaded}</span
        ><span>${item.source}</span>
        ${item.expires === null ? "" : html`<span>${item.expires}</span>`}
      </p>
      ${copyField(item.id, `media_id of ${item.label}`)}
      ${item.canDelete ? html`<div class="media-actions">${deleteControl(item, csrf)}</div>` : ""}
    </div>
  </li>`;
}

function section(media: MediaSection, csrf: string): Html {
  return html`<section class="card" aria-label="${media.badge.handle}">
    <div class="card-head">
      <div class="row">${who(media.badge)}<span class="faint">${media.owner}</span></div>
      <span class="faint">${String(media.items.length)} recent</span>
    </div>
    <div class="card-body">
      <ul class="media-grid">
        ${media.items.map((item) => tile(item, csrf))}
      </ul>
    </div>
  </section>`;
}

function list(view: MediaPageView, csrf: string): Html {
  if (view.groups.length === 0) {
    return html`<section class="card">
      ${empty(
        "image",
        "No accounts yet",
        "Connect an X account on the Accounts page first; then upload images for it here.",
        html`<a class="btn" href="/dashboard/accounts">Go to Accounts</a>`,
      )}
    </section>`;
  }
  if (view.sections.length === 0) {
    return html`<section class="card">
      ${empty(
        "image",
        view.filtered ? "No media for this account" : "No media yet",
        "Upload an image above, or have a bot stage one from a Grok image link.",
      )}
    </section>`;
  }
  return html`${view.sections.map((media) => section(media, csrf))}`;
}

export function mediaPage(view: MediaPageView, frame: PageFrame): Html {
  return shell(
    {
      title: "Media",
      subtitle: "Images a bot can attach to a post",
      switcher: { accounts: view.accounts, keep: {} },
      body: html`${uploadedNotice(view)} ${uploadCard(view, frame.csrf)} ${list(view, frame.csrf)}`,
    },
    frame,
  );
}

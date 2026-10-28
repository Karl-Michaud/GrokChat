import { html } from "hono/html";
import type { AccountBadge } from "../../../interface_adapters/dashboard/account_directory";
import type { Kpi } from "../../../interface_adapters/dashboard/analytics_views";
import type { Tab } from "../../../interface_adapters/dashboard/analytics_controller";
import type { Chip } from "../../../interface_adapters/dashboard/chips";
import { SPARK_HEIGHT, SPARK_WIDTH } from "../../../interface_adapters/dashboard/charts";
import { icon, type IconName } from "./icons";
import type { Html } from "./layout";

/** The session's CSRF token, carried by every form (plan §3.5, m4). */
export function csrfField(token: string): Html {
  return html`<input type="hidden" name="_csrf" value="${token}" />`;
}

/** A form with one button that posts to `action`. */
export function postButton(action: string, label: string, csrf: string, className = "btn"): Html {
  return html`<form method="post" action="${action}" class="inline-form">
    ${csrfField(csrf)}<button class="${className}">${label}</button>
  </form>`;
}

export function chip(value: Chip): Html {
  return html`<span class="chip ${value.tone}">${value.label}</span>`;
}

export function avatar(badge: AccountBadge, size = ""): Html {
  return html`<span class="avatar t${String(badge.tone)} ${size}" aria-hidden="true"
    >${badge.initials}</span
  >`;
}

/** An account as every page shows it: its avatar beside its handle (never colour alone). */
export function who(badge: AccountBadge): Html {
  return html`<span class="who">${avatar(badge)}<span>${badge.handle}</span></span>`;
}

const ARROWS = { up: "▲", down: "▼" } as const;

/** A change against the period before: coloured by what it means, "no change" muted. */
function deltaOf(kpi: Kpi, compared: string | null): Html {
  if (kpi.delta === null) {
    return "";
  }
  const { direction, text } = kpi.delta;
  const context = html`<span class="visually-hidden"> ${compared ?? ""}</span>`;
  if (direction === "flat") {
    return html`<span class="delta is-flat" title="${compared ?? ""}">No change${context}</span>`;
  }
  const tone = kpi.polarity === "neutral" ? "" : direction === "up" ? "is-good" : "is-bad";
  return html`<span class="delta ${tone}" title="${compared ?? ""}"
    ><span class="arrow" aria-hidden="true">${ARROWS[direction]}</span>${text}${context}</span
  >`;
}

function spark(path: string | null): Html {
  return path === null
    ? ""
    : html`<svg
        class="spark"
        viewBox="-1 -2 ${String(SPARK_WIDTH + 2)} ${String(SPARK_HEIGHT + 4)}"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="${path}" />
      </svg>`;
}

/** A headline tile: the figure, its change and its trend over the range. */
export function kpiTile(kpi: Kpi, compared: string | null): Html {
  return html`<div class="card kpi">
    <span class="kpi-label">${kpi.label}</span>
    <div class="kpi-main">
      <span class="kpi-value" title="${kpi.exact}">${kpi.value}</span>${spark(kpi.spark)}
    </div>
    ${deltaOf(kpi, compared)}
  </div>`;
}

/** A secondary stat: the same figure and change, compact, in a shared strip. */
export function kpiStat(kpi: Kpi, compared: string | null): Html {
  return html`<div class="kpi-stat">
    <span class="kpi-label">${kpi.label}</span>
    <span class="kpi-stat-value" title="${kpi.exact}">${kpi.value}</span>
    ${deltaOf(kpi, compared)}
  </div>`;
}

export function card(title: string, note: string | null, body: Html, extra: Html = ""): Html {
  return html`<section class="card">
    <div class="card-head">
      <div class="stack">
        <h2>${title}</h2>
        ${note === null ? "" : html`<p>${note}</p>`}
      </div>
      ${extra}
    </div>
    <div class="card-body">${body}</div>
  </section>`;
}

export function empty(name: IconName, title: string, text: string, action: Html = ""): Html {
  return html`<div class="empty">
    ${icon(name)}<strong>${title}</strong>
    <p>${text}</p>
    ${action}
  </div>`;
}

export function segmented(tabs: readonly Tab[], label: string): Html {
  return html`<nav class="segmented" aria-label="${label}">
    ${tabs.map((tab) => html`<a href="${tab.href}" aria-current="${tab.current ? "true" : "false"}">${tab.label}</a>`)}
  </nav>`;
}

export function tabs(items: readonly Tab[], label: string): Html {
  return html`<nav class="tabs" aria-label="${label}">
    ${items.map((tab) => html`<a href="${tab.href}" aria-current="${tab.current ? "true" : "false"}">${tab.label}</a>`)}
  </nav>`;
}

export function pager(
  view: {
    readonly total: string;
    readonly page: number;
    readonly pages: number;
    readonly previous: string | null;
    readonly next: string | null;
  },
  noun: string,
): Html {
  const link = (target: string | null, label: string) =>
    target === null
      ? html`<span class="btn btn-sm" aria-disabled="true">${label}</span>`
      : html`<a class="btn btn-sm" href="${target}">${label}</a>`;
  return html`<nav class="pager" aria-label="Pages">
    <span>${view.total} ${noun} · page ${String(view.page)} of ${String(view.pages)}</span>
    <span class="row">${link(view.previous, "Previous")} ${link(view.next, "Next")}</span>
  </nav>`;
}

export function copyField(value: string, label: string): Html {
  return html`<div class="copy-field">
    <code>${value}</code>
    <button type="button" class="btn btn-sm" data-copy="${value}" aria-label="Copy ${label}">
      ${icon("copy")}<span>Copy</span>
    </button>
  </div>`;
}

export function externalLink(target: string, label: string): Html {
  return html`<a href="${target}" target="_blank" rel="noopener noreferrer" class="row"
    >${label}${icon("external")}</a
  >`;
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly selected: boolean;
}

export function select(
  name: string,
  options: readonly SelectOption[],
  any: string | null,
  label: string,
): Html {
  return html`<label
    >${label}
    <select name="${name}">
      ${any === null ? "" : html`<option value="">${any}</option>`}
      ${options.map(
        (option) =>
          html`<option value="${option.value}" ${option.selected ? "selected" : ""}>
            ${option.label}
          </option>`,
      )}
    </select></label
  >`;
}

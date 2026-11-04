import { html } from "hono/html";
import {
  HEIGHT,
  WIDTH,
  type BarRow,
  type LineChartView,
  type MeterView,
} from "../../../interface_adapters/dashboard/charts";
import type { Html } from "./layout";

/**
 * Server-rendered SVG (dataviz skill): a 2 px line over a 10% wash, hairline gridlines, the axis
 * labels in HTML so they never stretch, and one hover column per bucket carrying the tooltip
 * (and the keyboard's, through app.js). Every chart has its table view.
 */

const EDGE = 0.2;

function tipClass(index: number, count: number): string {
  if (count > 4 && index < count * EDGE) {
    return "tip-start";
  }
  return count > 4 && index >= count * (1 - EDGE) ? "tip-end" : "";
}

function marks(chart: LineChartView): Html {
  const base = chart.gridlines.at(-1) ?? HEIGHT;
  const line = (y: number, className: string) =>
    html`<line
      class="${className}"
      x1="0"
      x2="${String(WIDTH)}"
      y1="${String(y)}"
      y2="${String(y)}"
    />`;
  return html`<svg
    viewBox="0 0 ${String(WIDTH)} ${String(HEIGHT)}"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    ${chart.gridlines.slice(0, -1).map((y) => line(y, "chart-grid"))} ${line(base, "chart-base")}
    <path class="chart-area" d="${chart.area}" />
    <path class="chart-line" d="${chart.line}" />
  </svg>`;
}

function columns(chart: LineChartView, series: string): Html {
  const count = chart.columns.length;
  return html`<div
    class="chart-cols"
    tabindex="0"
    role="group"
    aria-label="${series}: use the arrow keys to read each point"
  >
    ${chart.columns.map(
      (column, index) =>
        html`<div
          class="chart-col ${tipClass(index, count)}"
          aria-label="${column.label}: ${column.value} ${series}"
        >
          <div class="chart-tip"><strong>${column.value}</strong><span>${column.label}</span></div>
        </div>`,
    )}
  </div>`;
}

function plot(chart: LineChartView, series: string): Html {
  return html`<div class="chart-plot">
    ${marks(chart)} ${columns(chart, series)}
    ${chart.empty ? html`<div class="chart-empty">No ${series.toLowerCase()} in this range yet</div>` : ""}
  </div>`;
}

function table(chart: LineChartView, series: string): Html {
  return html`<details class="data-table">
    <summary>Show as a table</summary>
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Period</th>
            <th class="num">${series}</th>
          </tr>
        </thead>
        <tbody>
          ${chart.columns.map(
            (column) =>
              html`<tr>
                <td>${column.label}</td>
                <td class="num">${column.value}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>
  </details>`;
}

export function lineChartView(chart: LineChartView, series: string, size = ""): Html {
  return html`<figure class="chart ${size}">
      <div class="chart-y" aria-hidden="true">
        ${chart.ticks.map((tick) => html`<span>${tick}</span>`)}
      </div>
      ${plot(chart, series)}
      <div class="chart-x" aria-hidden="true">
        ${chart.columns.map((column) => html`<span>${column.axisLabel}</span>`)}
      </div>
    </figure>
    ${table(chart, series)}`;
}

function bar(percent: number, track: string, fill: string): Html {
  return html`<svg aria-hidden="true" preserveAspectRatio="none">
    <rect class="${track}" x="0" y="0" width="100%" height="8" rx="4" />
    ${percent <= 0 ? "" : html`<rect class="${fill}" x="0" y="0" width="${String(percent)}%" height="8" rx="4" />`}
  </svg>`;
}

export function barList(rows: readonly BarRow[]): Html {
  return html`<ul class="bars">
    ${rows.map(
      (row) =>
        html`<li>
          <span>${row.label}</span
          ><span class="num">${row.value}</span>${bar(row.percent, "bar-track", "bar-fill")}
        </li>`,
    )}
  </ul>`;
}

export function meterBar(view: MeterView): Html {
  return bar(view.percent, "meter-track", `meter-fill ${view.tone}`);
}

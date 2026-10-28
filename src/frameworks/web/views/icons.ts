import { html, raw } from "hono/html";
import type { Html } from "./layout";

/** Stroke icons (24-unit grid, `currentColor`), drawn for this dashboard; no icon font, no CDN. */
const PATHS = {
  analytics: "M4 19V5M4 19h16M8 15l3.5-4 3 2.5L20 7",
  posts: "M5 5h14M5 10h14M5 15h9M5 20h6",
  accounts:
    "M16 19v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 19v-1a3.5 3.5 0 0 0-2.5-3.3M15 4.2a3 3 0 0 1 0 5.6",
  activity: "M3 12h4l3 7 4-14 3 7h4",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10",
  theme: "M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  plus: "M12 5v14M5 12h14",
  copy: "M9 9h10v10H9zM5 15V5h10",
  inbox: "M4 13h4l2 3h4l2-3h4M4 13l2-8h12l2 8v6H4z",
  bot: "M12 4v3M7 7h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2M9.5 12h.01M14.5 12h.01M9 15h6",
  back: "M15 18l-6-6 6-6",
  key: "M14.5 4a5.5 5.5 0 1 1-4.9 8L4 17.6V20h3v-2h2v-2h2l.9-.9A5.5 5.5 0 0 1 14.5 4zM16 8.5h.01",
  warning: "M12 4 2.5 20h19zM12 10v4M12 17h.01",
  mark: "M5 7c0-1.7 1.3-3 3-3h8c1.7 0 3 1.3 3 3v6c0 1.7-1.3 3-3 3h-5l-4 4v-4c-1.7 0-2-1.3-2-3z",
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, className = "icon"): Html {
  return html`<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="${raw(PATHS[name])}" />
  </svg>`;
}

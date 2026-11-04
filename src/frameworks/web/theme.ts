import { getCookie } from "hono/cookie";
import type { WebContext } from "./web_context";

/** The viewer's choice: follow the system, or force light or dark (stored in a cookie). */
export type Theme = "system" | "light" | "dark";

export const THEME_COOKIE = "__Host-grokchat_theme";
export const THEMES: readonly Theme[] = ["system", "light", "dark"];

export function themeOf(value: string | undefined): Theme {
  return THEMES.find((theme) => theme === value) ?? "system";
}

export function currentTheme(c: WebContext): Theme {
  return themeOf(getCookie(c, THEME_COOKIE));
}

/** The toggle cycles system → light → dark → system. */
export function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? "system";
}

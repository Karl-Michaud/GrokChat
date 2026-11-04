import type { Outcome } from "../../interface_adapters/dashboard/outcome";
import { currentTheme, type Theme } from "./theme";
import { errorPage, type Html } from "./views/layout";
import type { WebContext } from "./web_context";

/** What every page's chrome needs besides its own view. */
export interface PageFrame {
  readonly csrf: string;
  readonly theme: Theme;
  /** The request's path, for the active navigation item. */
  readonly path: string;
}

export function frameOf(c: WebContext): PageFrame {
  return { csrf: c.get("session")?.csrf ?? "", theme: currentTheme(c), path: c.req.path };
}

/** A controller's outcome as a response: the rendered page, a 303, or the refusal page. */
export function respond<View>(
  c: WebContext,
  outcome: Outcome<View>,
  render: (view: View, frame: PageFrame) => Html,
): Response | Promise<Response> {
  const frame = frameOf(c);
  switch (outcome.kind) {
    case "page":
      return c.html(render(outcome.view, frame));
    case "redirect":
      return c.redirect(outcome.location, 303);
    case "refused":
      return c.html(errorPage(outcome.message, frame), outcome.status);
  }
}

/** For commands: they answer a redirect or a refusal, never a page. */
export const NO_PAGE = (): never => {
  throw new Error("a command renders no page");
};

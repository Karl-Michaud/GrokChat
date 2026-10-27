import type { Outcome } from "../../interface_adapters/dashboard/outcome";
import { errorPage, type Html } from "./views/layout";
import type { WebContext } from "./web_context";

/** A controller's outcome as a response: the rendered page, a 303, or the refusal page. */
export function respond<View>(
  c: WebContext,
  outcome: Outcome<View>,
  render: (view: View, csrf: string) => Html,
): Response | Promise<Response> {
  const csrf = c.get("session")?.csrf ?? null;
  switch (outcome.kind) {
    case "page":
      return c.html(render(outcome.view, csrf ?? ""));
    case "redirect":
      return c.redirect(outcome.location, 303);
    case "refused":
      return c.html(errorPage(outcome.message, csrf), outcome.status);
  }
}

/** For commands: they answer a redirect or a refusal, never a page. */
export const NO_PAGE = (): never => {
  throw new Error("a command renders no page");
};

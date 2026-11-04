import { refusalView, type RefusalView } from "./refusals";

/** What a dashboard controller returns to the route: a page to render, a redirect, or a refusal. */
export type Outcome<View> =
  | { readonly kind: "page"; readonly view: View }
  | { readonly kind: "redirect"; readonly location: string }
  | ({ readonly kind: "refused" } & RefusalView);

export const page = <View>(view: View): Outcome<View> => ({ kind: "page", view });

export const redirect = (location: string): Outcome<never> => ({ kind: "redirect", location });

export const refused = (code: string): Outcome<never> => ({
  kind: "refused",
  ...refusalView(code),
});

/** A refusal from parsing a form, before any use case ran. */
export const invalid = (message: string): Outcome<never> => ({
  kind: "refused",
  status: 400,
  message,
});

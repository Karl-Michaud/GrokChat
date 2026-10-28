import type { WebControllers } from "./controllers";
import { fields, formBody } from "./form_body";
import { respond, NO_PAGE } from "./respond";
import { accountsPage } from "./views/accounts_page";
import { tokenPage } from "./views/token_page";
import type { WebApp } from "./web_context";

const POLICY_FIELDS = [
  "mode",
  "dailyCap",
  "minGapMinutes",
  "quietStart",
  "quietEnd",
  "tz",
  "linkPolicy",
  "graceMinutes",
] as const;

/** Accounts: status (the kill switch), disclosure, policy (plan §3.4); people (GROKCHAT-16). */
export function accountRoutes(app: WebApp, controllers: WebControllers): void {
  const { accounts } = controllers;
  app.get("/dashboard/accounts", async (c) => {
    const outcome = await accounts.accounts({
      connected: c.req.query("connected") ?? null,
      origin: c.get("config").origin,
    });
    return respond(c, outcome, accountsPage);
  });
  app.post("/dashboard/accounts/:id/status", async (c) =>
    respond(c, await accounts.status(c.req.param("id"), c.req.query("to") ?? ""), NO_PAGE),
  );
  app.post("/dashboard/accounts/:id/disclosure", async (c) => {
    const body = await formBody(c);
    const form = {
      bioConfirmed: body.checked("bioConfirmed"),
      automatedLabelConfirmed: body.checked("automatedLabelConfirmed"),
    };
    return respond(c, await accounts.disclosure(c.req.param("id"), form), NO_PAGE);
  });
  app.post("/dashboard/accounts/:id/policy", async (c) => {
    const form = fields(await formBody(c), POLICY_FIELDS);
    return respond(c, await accounts.policy(c.req.param("id"), form), NO_PAGE);
  });
  peopleRoutes(app, controllers);
}

/**
 * People (GROKCHAT-16). The token route answers the POST with the one-time panel itself: never a
 * redirect, so the token is in no URL, and (like every dashboard response) `no-store`.
 */
function peopleRoutes(app: WebApp, { people }: WebControllers): void {
  app.post("/dashboard/people", async (c) =>
    respond(c, await people.create((await formBody(c)).one("name")), NO_PAGE),
  );
  app.post("/dashboard/people/:id/rename", async (c) => {
    const name = (await formBody(c)).one("name");
    return respond(c, await people.rename(c.req.param("id"), name), NO_PAGE);
  });
  app.post("/dashboard/people/:id/delete", async (c) => {
    const confirmation = (await formBody(c)).one("confirmation");
    return respond(c, await people.remove(c.req.param("id"), confirmation), NO_PAGE);
  });
  app.post("/dashboard/people/:id/token", async (c) => {
    const outcome = await people.token(c.req.param("id"), c.get("config").origin);
    c.header("Cache-Control", "no-store");
    return respond(c, outcome, tokenPage);
  });
  app.post("/dashboard/accounts/:id/owner", async (c) => {
    const person = (await formBody(c)).one("person");
    return respond(c, await people.assign(c.req.param("id"), person), NO_PAGE);
  });
}

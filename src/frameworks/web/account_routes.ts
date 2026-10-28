import type { WebControllers } from "./controllers";
import { fields, formBody } from "./form_body";
import { respond, NO_PAGE } from "./respond";
import { accountsPage } from "./views/accounts_page";
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

/** Accounts: status (the kill switch), disclosure, policy (plan §3.4). */
export function accountRoutes(app: WebApp, { accounts }: WebControllers): void {
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
}

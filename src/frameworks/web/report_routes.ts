import type { WebControllers } from "./controllers";
import { respond } from "./respond";
import { auditPage, costsPage, mediaPage, metricsPage } from "./views/report_pages";
import type { WebApp } from "./web_context";

/** Metrics, costs, R2 media usage and the audit log. */
export function reportRoutes(app: WebApp, { reports }: WebControllers): void {
  app.get("/dashboard/metrics", async (c) => {
    const query = { account: c.req.query("account") ?? null, days: c.req.query("days") ?? null };
    return respond(c, await reports.metrics(query), metricsPage);
  });
  app.get("/dashboard/costs", async (c) =>
    respond(c, await reports.costs({ days: c.req.query("days") ?? null }), costsPage),
  );
  app.get("/dashboard/media", async (c) => respond(c, await reports.media(), mediaPage));
  app.get("/dashboard/audit", async (c) => {
    const query = { account: c.req.query("account") ?? null, limit: c.req.query("limit") ?? null };
    return respond(c, await reports.audit(query), auditPage);
  });
}

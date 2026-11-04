import type { WebControllers } from "./controllers";
import { respond } from "./respond";
import { activityPage } from "./views/activity_page";
import { analyticsPage } from "./views/analytics_page";
import type { WebApp } from "./web_context";

/** Analytics and activity (GROKCHAT-15): read-only pages over the read models. */
export function reportRoutes(app: WebApp, { analytics, activity }: WebControllers): void {
  app.get("/dashboard/analytics", async (c) => {
    const query = {
      range: c.req.query("range") ?? null,
      metric: c.req.query("metric") ?? null,
      account: c.req.query("account") ?? null,
    };
    return respond(c, await analytics.analytics(query), analyticsPage);
  });
  app.get("/dashboard/activity", async (c) => {
    const query = {
      account: c.req.query("account") ?? null,
      actor: c.req.query("actor") ?? null,
      kind: c.req.query("kind") ?? null,
      page: c.req.query("page") ?? null,
    };
    return respond(c, await activity.activity(query), activityPage);
  });
}

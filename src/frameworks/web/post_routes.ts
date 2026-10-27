import type { WebControllers } from "./controllers";
import { formBody } from "./form_body";
import { NO_PAGE, respond } from "./respond";
import { backlogPage, calendarPage, postPage } from "./views/post_pages";
import type { WebApp } from "./web_context";

/** Backlog, calendar, post detail and the post's commands (plan §3.4). */
export function postRoutes(app: WebApp, { postPages, postCommands }: WebControllers): void {
  app.get("/dashboard/backlog", async (c) => {
    const query = {
      account: c.req.query("account") ?? null,
      status: c.req.query("status") ?? null,
    };
    return respond(c, await postPages.backlog(query), backlogPage);
  });
  app.get("/dashboard/calendar", async (c) =>
    respond(c, await postPages.calendar({ start: c.req.query("start") ?? null }), calendarPage),
  );
  app.get("/dashboard/posts/:id", async (c) =>
    respond(c, await postPages.detail(c.req.param("id")), postPage),
  );
  app.post("/dashboard/posts/:id/edit", async (c) => {
    const body = await formBody(c);
    const form = {
      texts: body.all("text"),
      media: body.all("media"),
      publishAt: body.one("publishAt"),
    };
    return respond(c, await postCommands.edit(c.req.param("id"), form), NO_PAGE);
  });
  app.post("/dashboard/posts/:id/reschedule", async (c) => {
    const body = await formBody(c);
    const form = {
      publishAt: body.one("publishAt"),
      confirmedNotOnX: body.checked("confirmedNotOnX"),
    };
    return respond(c, await postCommands.reschedule(c.req.param("id"), form), NO_PAGE);
  });
  const simple = ["approve", "reject", "cancel", "delete"] as const;
  for (const command of simple) {
    app.post(`/dashboard/posts/:id/${command}`, async (c) =>
      respond(c, await postCommands[command](c.req.param("id")), NO_PAGE),
    );
  }
}

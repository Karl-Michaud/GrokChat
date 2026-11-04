import type { WebControllers } from "./controllers";
import { formBody } from "./form_body";
import { NO_PAGE, respond } from "./respond";
import { postPage } from "./views/post_page";
import { postsPage } from "./views/posts_page";
import type { WebApp } from "./web_context";

/** The posts page, a post's page and the post's commands (GROKCHAT-15, plan §3.4). */
export function postRoutes(app: WebApp, { posts, postCommands }: WebControllers): void {
  app.get("/dashboard/posts", async (c) => {
    const query = {
      account: c.req.query("account") ?? null,
      status: c.req.query("status") ?? null,
      from: c.req.query("from") ?? null,
      to: c.req.query("to") ?? null,
      sort: c.req.query("sort") ?? null,
      dir: c.req.query("dir") ?? null,
      page: c.req.query("page") ?? null,
    };
    return respond(c, await posts.posts(query), postsPage);
  });
  app.get("/dashboard/posts/:id", async (c) =>
    respond(c, await posts.detail(c.req.param("id")), postPage),
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

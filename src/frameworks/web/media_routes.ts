import { MEDIA_PAGE } from "../../interface_adapters/dashboard/media_controller";
import type { WebControllers } from "./controllers";
import { formBody } from "./form_body";
import { frameOf, respond, NO_PAGE } from "./respond";
import { errorPage } from "./views/layout";
import { mediaPage } from "./views/media_page";
import type { WebApp } from "./web_context";

/**
 * The thumbnail's caching: the bytes behind a media_id never change, so the browser may keep them
 * a day (saving R2 reads), privately: never a shared cache.
 */
export const MEDIA_FILE_CACHE = "private, max-age=86400, immutable";

/**
 * The Media page (GROKCHAT-18). The upload is a plain multipart POST with the CSRF field (no
 * script needed); the thumbnail route serves the bytes same-origin behind the session, so the CSP
 * keeps `img-src 'self'`.
 */
export function mediaRoutes(app: WebApp, { media }: WebControllers): void {
  app.get(MEDIA_PAGE, async (c) => {
    const query = { account: c.req.query("account") ?? null, uploaded: c.req.query("uploaded") ?? null };
    return respond(c, await media.media(query), mediaPage);
  });
  app.post(MEDIA_PAGE, async (c) => {
    const body = await formBody(c);
    const file = body.file("file");
    const form = {
      account: body.one("account"),
      label: body.one("label"),
      bytes: file === null ? null : new Uint8Array(await file.arrayBuffer()),
    };
    return respond(c, await media.upload(form), NO_PAGE);
  });
  app.post(`${MEDIA_PAGE}/:id/delete`, async (c) =>
    respond(c, await media.remove(c.req.param("id")), NO_PAGE),
  );
  app.get(`${MEDIA_PAGE}/:id/file`, async (c) => {
    const outcome = await media.file(c.req.param("id"));
    if (outcome.kind !== "page") {
      const message = outcome.kind === "refused" ? outcome.message : "Not found.";
      return c.html(errorPage(message, frameOf(c)), outcome.kind === "refused" ? outcome.status : 404);
    }
    c.header("Content-Type", outcome.view.contentType);
    c.header("Content-Disposition", "inline");
    c.header("Cache-Control", MEDIA_FILE_CACHE);
    return c.body(outcome.view.bytes.slice().buffer);
  });
}

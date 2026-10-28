/** The Media page's routes and views (GROKCHAT-18) over the in-memory world. */
import { describe, expect, it } from "vitest";
import { postId } from "../../../src/entities/identity/ids";
import { R2_GUARDS } from "../../../src/entities/media/r2_quota";
import { ACCOUNT, aPost } from "../../unit/support/builders";
import { dashboard } from "./browser";

async function loggedIn(accounts = 1) {
  const setup = await dashboard();
  for (let index = 0; index < accounts; index += 1) {
    await setup.world.seedAccount();
  }
  await setup.browser.login();
  return setup;
}

describe("the Media page (GROKCHAT-18)", () => {
  it("is in the navigation; with no account it says to connect one, with no upload form", async () => {
    const { browser } = await loggedIn(0);
    const { status, html } = await browser.page("/dashboard/media");
    expect(status).toBe(200);
    expect(html).toContain('href="/dashboard/media"');
    expect(html).toContain("No accounts yet");
    expect(html).not.toContain('enctype="multipart/form-data"');
  });

  it("an account with nothing staged: the upload form, and an empty state for the filter", async () => {
    const { browser, world } = await loggedIn();
    const [account] = await world.accounts.list();
    const { html } = await browser.page("/dashboard/media");
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain('hx-boost="false"');
    expect(html).toContain('accept="image/png,image/jpeg,image/webp,image/gif"');
    expect(html).toContain("No media yet");
    expect(html).not.toMatch(/<script>|onclick=|style="/);
    const filtered = await browser.page(`/dashboard/media?account=${account?.id ?? ""}`);
    expect(filtered.html).toContain("No media for this account");
    expect((await browser.page("/dashboard/media?account=ghost")).status).toBe(400);
  });

  it("a used item has no Delete; an unused one does; both show their media_id", async () => {
    const { browser, world } = await loggedIn();
    const used = await world.stage(ACCOUNT, "PHOTO", "m-used");
    await world.stage(ACCOUNT, "GIF", "m-free");
    await world.writer.add(aPost({ id: postId("p-wait"), lifecycle: "SCHEDULED" }));
    await world.media.save({ ...used, attachedTo: postId("p-wait"), label: "held" });
    const { html } = await browser.page("/dashboard/media");
    expect(html).toContain('data-copy="m-used"');
    expect(html).toContain('data-copy="m-free"');
    expect(html).toContain('action="/dashboard/media/m-free/delete"');
    expect(html).not.toContain('action="/dashboard/media/m-used/delete"');
    expect(html).toContain('alt="held"');
    expect(html).toContain('alt="Untitled image"');
  });

  it("the thumbnail route: an unknown id is 404, past the read guard 409, both as pages", async () => {
    const { browser, world } = await loggedIn();
    await world.stage(ACCOUNT, "PHOTO", "m-1");
    const missing = await browser.get("/dashboard/media/ghost/file");
    expect([missing.status, missing.headers.get("content-type")]).toStrictEqual([
      404,
      "text/html; charset=UTF-8",
    ]);
    const served = await browser.get("/dashboard/media/m-1/file");
    expect(served.status).toBe(200);
    await world.usage.record(
      { storedBytes: 0, classA: 0, classB: R2_GUARDS.classB },
      world.clock.now(),
    );
    const guarded = await browser.get("/dashboard/media/m-1/file");
    expect(guarded.status).toBe(409);
    expect(await guarded.text()).toContain("free-tier guard");
  });

  it("an upload shows its media_id in a notice to copy", async () => {
    const { browser } = await loggedIn();
    const { html } = await browser.page("/dashboard/media?uploaded=m-new");
    expect(html).toContain("<strong>Uploaded.</strong>");
    expect(html).toContain('data-copy="m-new"');
  });
});

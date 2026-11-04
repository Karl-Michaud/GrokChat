/** The dashboard's forms through the web app: posts, accounts, the theme (GROKCHAT-15). */
import { describe, expect, it } from "vitest";
import { postId } from "../../../src/entities/identity/ids";
import { THEME_COOKIE } from "../../../src/frameworks/web/theme";
import { backTo } from "../../../src/frameworks/web/session_routes";
import { ACCOUNT, aPost, part, sentState, T0 } from "../../unit/support/builders";
import { dashboard } from "./browser";

async function loggedIn() {
  const setup = await dashboard();
  await setup.world.seedAccount();
  await setup.browser.login();
  return setup;
}

describe("a post's commands", () => {
  it("approve, then the post page shows it scheduled; a second approve is refused", async () => {
    const { browser, world } = await loggedIn();
    await world.writer.add(aPost({ lifecycle: "PENDING_REVIEW" }));
    const page = await browser.page("/dashboard/posts/post-1");
    expect(page.html).toContain('action="/dashboard/posts/post-1/approve"');
    expect(page.html).toContain('action="/dashboard/posts/post-1/reject"');
    const response = await browser.post("/dashboard/posts/post-1/approve");
    expect([response.status, response.headers.get("location")]).toStrictEqual([
      303,
      "/dashboard/posts/post-1",
    ]);
    expect((await browser.page("/dashboard/posts/post-1")).html).toContain(
      'class="chip info">Scheduled</span>',
    );
    expect((await browser.post("/dashboard/posts/post-1/approve")).status).toBe(409);
  });

  it("edit keeps media; reject, cancel, reschedule (with the X check) and delete", async () => {
    const { browser, world } = await loggedIn();
    const media = await world.stage(ACCOUNT, "PHOTO", "m-a");
    await world.writer.add(aPost({ parts: [part("a", undefined, [media.id]), part("b")] }));
    expect((await browser.page("/dashboard/posts/post-1")).html).toContain(
      '<input type="hidden" name="media" value="m-a" />',
    );
    const edited = await browser.post("/dashboard/posts/post-1/edit", {
      text: ["new a", "new b"],
      media: ["m-a", ""],
      publishAt: "2026-10-28T09:00",
    });
    expect(edited.status).toBe(303);
    const post = await world.reader.get(postId("post-1"));
    expect(post?.parts.map((p) => [p.text, p.media])).toStrictEqual([
      ["new a", [media.id]],
      ["new b", []],
    ]);
    expect((await browser.post("/dashboard/posts/post-1/cancel")).status).toBe(303);
    await world.writer.add(aPost({ id: postId("post-2"), lifecycle: "PENDING_REVIEW" }));
    expect((await browser.post("/dashboard/posts/post-2/reject")).status).toBe(303);
    await world.writer.add(aPost({ id: postId("post-3"), lifecycle: "MISSED" }));
    expect((await browser.page("/dashboard/posts/post-3")).html).toContain(
      'action="/dashboard/posts/post-3/reschedule"',
    );
    expect(
      (await browser.post("/dashboard/posts/post-3/reschedule", { publishAt: "2026-10-29T10:00" }))
        .status,
    ).toBe(303);
    await world.writer.add(
      aPost({
        id: postId("post-4"),
        lifecycle: "DONE",
        parts: [part("a", { kind: "NOT_FOUND", attemptAt: T0 })],
      }),
    );
    expect((await browser.page("/dashboard/posts/post-4")).html).toContain(
      'name="confirmedNotOnX"',
    );
    expect(
      (await browser.post("/dashboard/posts/post-4/reschedule", { publishAt: "2026-10-29T10:00" }))
        .status,
    ).toBe(400);
    expect(
      (
        await browser.post("/dashboard/posts/post-4/reschedule", {
          publishAt: "2026-10-29T10:00",
          confirmedNotOnX: "yes",
        })
      ).status,
    ).toBe(303);
    await world.writer.add(
      aPost({ id: postId("post-5"), lifecycle: "DONE", parts: [part("a", sentState("x-5"))] }),
    );
    expect((await browser.page("/dashboard/posts/post-5")).html).toContain("Delete on X");
    expect((await browser.post("/dashboard/posts/post-5/delete")).status).toBe(303);
    const deleted = await browser.page("/dashboard/posts/post-5");
    expect(deleted.html).toContain('class="chip neutral">Deleted</span>');
    expect(deleted.html).not.toContain("https://x.com/musechat_one/status/x-5");
  });

  it("a command without the CSRF token or from another origin is refused, and changes nothing", async () => {
    const { browser, world } = await loggedIn();
    await world.writer.add(aPost({ lifecycle: "PENDING_REVIEW" }));
    expect((await browser.post("/dashboard/posts/post-1/approve", {}, { csrf: null })).status).toBe(
      403,
    );
    expect(
      (await browser.post("/dashboard/posts/post-1/approve", {}, { origin: "https://evil.test" }))
        .status,
    ).toBe(403);
    expect((await world.reader.get(postId("post-1")))?.lifecycle).toBe("PENDING_REVIEW");
  });
});

describe("an account's commands", () => {
  it("the kill switch, the disclosure and the policy", async () => {
    const { browser, world } = await loggedIn();
    const accounts = await browser.page("/dashboard/accounts");
    expect(accounts.html).toContain('action="/dashboard/accounts/acc-1/status?to=PAUSED"');
    expect((await browser.post("/dashboard/accounts/acc-1/status?to=PAUSED")).status).toBe(303);
    expect((await world.accounts.list())[0]?.status).toBe("PAUSED");
    const paused = await browser.page("/dashboard/accounts");
    expect(paused.html).toContain('action="/dashboard/accounts/acc-1/status?to=ACTIVE"');
    expect(paused.html).toContain('aria-checked="false"');
    expect(
      (await browser.post("/dashboard/accounts/acc-1/disclosure", { bioConfirmed: "yes" })).status,
    ).toBe(303);
    expect((await world.accounts.list())[0]?.disclosure).toStrictEqual({
      bioConfirmed: true,
      automatedLabelConfirmed: false,
    });
    expect((await browser.page("/dashboard/accounts")).html).toContain(
      "Required before publishing",
    );
    const policy = {
      mode: "REVIEW",
      dailyCap: "5",
      minGapMinutes: "10",
      quietStart: "22:00",
      quietEnd: "06:00",
      tz: "Europe/Paris",
      linkPolicy: "REFUSE",
      graceMinutes: "15",
    };
    expect((await browser.post("/dashboard/accounts/acc-1/policy", policy)).status).toBe(303);
    expect((await world.accounts.list())[0]?.policy).toMatchObject({ mode: "REVIEW", dailyCap: 5 });
    expect((await browser.page("/dashboard/accounts")).html).toContain("Quiet 22:00–06:00");
    expect(
      (await browser.post("/dashboard/accounts/acc-1/policy", { ...policy, tz: "Mars/Base" }))
        .status,
    ).toBe(400);
  });

  it("shows NEEDS_RECONNECT; connecting a new account asks for no personality", async () => {
    const { browser, world } = await dashboard();
    await world.seedAccount({ status: "NEEDS_RECONNECT" });
    await browser.login();
    const page = await browser.page("/dashboard/accounts");
    expect(page.html).toContain('class="chip critical">Reconnect needed</span>');
    expect(page.html).toContain("Publishing is refused until this account is reconnected on X.");
    expect(page.html).toContain('<input type="hidden" name="reconnect" value="acc-1" />');
    expect(page.html).not.toContain('name="personality"');
    const started = await browser.post("/oauth/x/start", {});
    expect(started.status).toBe(303);
    expect(new URL(started.headers.get("location") ?? "").origin).toBe("https://x.com");
  });
});

describe("the theme toggle", () => {
  it("cycles system → light → dark → system, kept in a Strict cookie, and goes back", async () => {
    const { browser } = await loggedIn();
    expect((await browser.page("/dashboard/posts")).html).toMatch(/<html lang="en" >/);
    const seen: (string | undefined)[] = [];
    for (let n = 0; n < 3; n += 1) {
      const response = await browser.post("/dashboard/theme", { back: "/dashboard/posts" });
      expect([response.status, response.headers.get("location")]).toStrictEqual([
        303,
        "/dashboard/posts",
      ]);
      expect(response.headers.get("set-cookie")).toMatch(
        /Max-Age=31536000; Path=\/; HttpOnly; Secure; SameSite=Strict/,
      );
      seen.push(browser.cookies.get(THEME_COOKIE));
      const html = (await browser.page("/dashboard/posts")).html;
      if (seen.at(-1) !== "system") {
        expect(html).toContain(`<html lang="en" data-theme="${seen.at(-1) ?? ""}">`);
      }
    }
    expect(seen).toStrictEqual(["light", "dark", "system"]);
  });

  it("goes back only to a dashboard page, and needs the CSRF token", async () => {
    const { browser } = await loggedIn();
    const away = await browser.post("/dashboard/theme", { back: "https://evil.test/" });
    expect(away.headers.get("location")).toBe("/dashboard/analytics");
    expect(
      (await browser.post("/dashboard/theme", { back: "/dashboard" }, { csrf: null })).status,
    ).toBe(403);
    expect([
      backTo(null),
      backTo("/dashboard"),
      backTo("/dashboard/posts/p-1"),
      backTo("//evil.test"),
      backTo("/dashboard/../x?y"),
    ]).toStrictEqual([
      "/dashboard/analytics",
      "/dashboard",
      "/dashboard/posts/p-1",
      "/dashboard/analytics",
      "/dashboard/analytics",
    ]);
  });
});

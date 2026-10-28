/** The Media page's controller (GROKCHAT-18), over the in-memory world. */
import { describe, expect, it } from "vitest";
import {
  accountId,
  personId,
  postId,
  stagedMediaId,
  xUserId,
} from "../../../../src/entities/identity/ids";
import { MAX_LABEL_LENGTH } from "../../../../src/entities/media/media_label";
import { DAY } from "../../../../src/entities/time/instant";
import {
  MEDIA_ACCEPT,
  MEDIA_PAGE,
  MEDIA_PER_ACCOUNT,
  MediaController,
  type MediaPageView,
} from "../../../../src/interface_adapters/dashboard/media_controller";
import { refusalView } from "../../../../src/interface_adapters/dashboard/refusals";
import { anAccount, aPerson, aPost, ACCOUNT, OTHER_ACCOUNT, T0 } from "../../support/builders";
import { dashboardUseCases } from "../../support/dashboard";
import { makeWorld, PNG, type World } from "../../support/world";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

async function setup() {
  const world = makeWorld();
  await world.seedAccount({ handle: "one" });
  await world.accounts.save(
    anAccount({ id: OTHER_ACCOUNT, xUserId: xUserId("x-2"), handle: "two" }),
  );
  await world.accounts.save(
    anAccount({ id: accountId("acc-3"), xUserId: xUserId("x-3"), handle: "three" }),
  );
  return { world, media: new MediaController(dashboardUseCases(world)) };
}

async function view(
  media: MediaController,
  query: { account?: string; uploaded?: string } = {},
): Promise<MediaPageView> {
  const outcome = await media.media({
    account: query.account ?? null,
    uploaded: query.uploaded ?? null,
  });
  if (outcome.kind !== "page") {
    throw new Error(JSON.stringify(outcome));
  }
  return outcome.view;
}

async function uploaded(world: World, media: MediaController, label: string, account = ACCOUNT) {
  const outcome = await media.upload({ account, label, bytes: PNG });
  if (outcome.kind !== "redirect") {
    throw new Error(JSON.stringify(outcome));
  }
  const [item] = await world.catalog.recent(account, 1);
  return { outcome, id: String(item?.id) };
}

describe("MediaController: upload (GROKCHAT-18)", () => {
  it("stores the file for the account with its label, then shows its media_id to copy", async () => {
    const { world, media } = await setup();
    const { outcome, id } = await uploaded(world, media, "  launch   banner ");
    expect(outcome).toStrictEqual({
      kind: "redirect",
      location: `${MEDIA_PAGE}?account=${ACCOUNT}&uploaded=${id}`,
    });
    const stored = await world.media.get(stagedMediaId(id));
    expect(stored).toMatchObject({
      ownerAccountId: ACCOUNT,
      label: "launch banner",
      source: { kind: "dashboard" },
      contentType: "image/png",
      size: PNG.length,
    });
    expect((await view(media, { uploaded: id })).uploaded).toBe(id);
  });

  it("refuses no file, an empty file, a non-image, a long label and an unknown account", async () => {
    const { world, media } = await setup();
    const cases = [
      [{ account: ACCOUNT, label: "", bytes: null }, "no_file"],
      [{ account: ACCOUNT, label: "", bytes: new Uint8Array() }, "no_file"],
      [{ account: ACCOUNT, label: "", bytes: new TextEncoder().encode("GIF? no") }, "not_media"],
      [{ account: ACCOUNT, label: "x".repeat(MAX_LABEL_LENGTH + 1), bytes: PNG }, "invalid_label"],
      [{ account: "ghost", label: "", bytes: PNG }, "not_found"],
    ] as const;
    for (const [form, code] of cases) {
      expect([code, await media.upload(form)]).toStrictEqual([
        code,
        { kind: "refused", ...refusalView(code) },
      ]);
    }
    expect(await world.media.list()).toStrictEqual([]);
  });
});

describe("MediaController: the page (GROKCHAT-18)", () => {
  it("one section per account with media, people's accounts first by name, then unassigned", async () => {
    const { world, media } = await setup();
    await world.people.save(aPerson({ id: personId("p-z"), name: "Zoe" }));
    await world.people.save(aPerson({ id: personId("p-a"), name: "Amy" }));
    await world.owners.assign(OTHER_ACCOUNT, personId("p-z"));
    await world.owners.assign(accountId("acc-3"), personId("p-a"));
    await uploaded(world, media, "banner");
    world.clock.advance(1000);
    await uploaded(world, media, "", accountId("acc-3"));
    const page = await view(media);
    expect(page.groups).toStrictEqual([
      { label: "Amy", options: [{ value: "acc-3", label: "@three", selected: false }] },
      { label: "Zoe", options: [{ value: "acc-2", label: "@two", selected: false }] },
      { label: "Unassigned", options: [{ value: "acc-1", label: "@one", selected: false }] },
    ]);
    expect(page.sections.map((section) => [section.badge.handle, section.owner])).toStrictEqual([
      ["@three", "Amy"],
      ["@one", "Unassigned"],
    ]);
    expect([page.accept, page.maxLabel, page.filtered, page.uploaded]).toStrictEqual([
      MEDIA_ACCEPT,
      MAX_LABEL_LENGTH,
      false,
      null,
    ]);
    const [untitled] = page.sections[0]?.items ?? [];
    expect(untitled).toMatchObject({ label: "Untitled", labelled: false });
    const [banner] = page.sections[1]?.items ?? [];
    expect(banner).toStrictEqual({
      id: banner?.id,
      label: "banner",
      labelled: true,
      fileUrl: `${MEDIA_PAGE}/${banner?.id ?? ""}/file`,
      type: "PNG",
      size: `${String(PNG.length)} B`,
      uploaded: banner?.uploaded,
      source: "Dashboard upload",
      status: { label: "Unused", tone: "neutral" },
      expires: "Deleted if unused on Oct 29",
      canDelete: true,
    });
  });

  it("filters to one account, selecting it in the upload form; an unknown account is refused", async () => {
    const { world, media } = await setup();
    await uploaded(world, media, "a");
    await uploaded(world, media, "b", OTHER_ACCOUNT);
    const page = await view(media, { account: OTHER_ACCOUNT });
    expect(page.filtered).toBe(true);
    expect(page.sections.map((section) => section.badge.id)).toStrictEqual([OTHER_ACCOUNT]);
    expect(page.groups.flatMap((group) => group.options).filter((o) => o.selected)).toStrictEqual([
      { value: OTHER_ACCOUNT, label: "@two", selected: true },
    ]);
    expect(page.accounts.filter((option) => option.selected).map((o) => o.id)).toStrictEqual([
      OTHER_ACCOUNT,
    ]);
    expect((await view(media, { account: "" })).filtered).toBe(false);
    expect(await media.media({ account: "ghost", uploaded: null })).toStrictEqual({
      kind: "refused",
      status: 400,
      message: "Unknown account.",
    });
  });

  it("media a waiting post holds is Used, kept, and cannot be deleted; a done post's is kept a week", async () => {
    const { world, media } = await setup();
    const held = await world.stage(ACCOUNT, "PHOTO", "m-held");
    const done = await world.stage(ACCOUNT, "GIF", "m-done");
    const fetched = { ...(await world.stage(ACCOUNT, "PHOTO", "m-url")), attachedTo: null };
    await world.media.save({
      ...fetched,
      source: { kind: "url", host: "imgen.x.ai" },
      contentType: "image/x-odd",
    });
    await world.writer.add(aPost({ id: postId("p-wait"), lifecycle: "SCHEDULED" }));
    await world.writer.add(aPost({ id: postId("p-done"), lifecycle: "DONE" }));
    await world.media.save({ ...held, attachedTo: postId("p-wait") });
    await world.media.save({ ...done, attachedTo: postId("p-done") });
    const items = (await view(media)).sections[0]?.items ?? [];
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get("m-held")).toMatchObject({
      status: { label: "Used", tone: "good" },
      expires: null,
      canDelete: false,
    });
    expect(byId.get("m-done")).toMatchObject({
      type: "GIF",
      status: { label: "Used", tone: "good" },
      expires: `Kept until ${new Date(T0 + 7 * DAY).toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`,
    });
    expect(byId.get("m-url")).toMatchObject({ source: "imgen.x.ai", type: "image/x-odd" });
  });

  it(`shows at most ${String(MEDIA_PER_ACCOUNT)} items per account, newest first`, async () => {
    const { world, media } = await setup();
    for (let index = 0; index < MEDIA_PER_ACCOUNT + 2; index += 1) {
      world.clock.advance(1);
      await world.stage(ACCOUNT, "PHOTO", `m-${String(index).padStart(2, "0")}`);
    }
    const items = (await view(media)).sections[0]?.items ?? [];
    expect(items).toHaveLength(MEDIA_PER_ACCOUNT);
    expect(items[0]?.id).toBe(`m-${String(MEDIA_PER_ACCOUNT + 1)}`);
  });

  it("no accounts: no upload groups and no sections", async () => {
    const world = makeWorld();
    const page = await view(new MediaController(dashboardUseCases(world)));
    expect([page.groups, page.sections]).toStrictEqual([[], []]);
  });
});

describe("MediaController: delete and thumbnails (GROKCHAT-18)", () => {
  it("deletes unused media and goes back to its account; refuses what a post holds", async () => {
    const { world, media } = await setup();
    const { id } = await uploaded(world, media, "gone");
    expect(await media.remove(id)).toStrictEqual({
      kind: "redirect",
      location: `${MEDIA_PAGE}?account=${ACCOUNT}`,
    });
    expect(await world.media.get(stagedMediaId(id))).toBeNull();
    const held = await world.stage(ACCOUNT);
    await world.writer.add(aPost({ id: postId("p-wait"), lifecycle: "SCHEDULED" }));
    await world.media.save({ ...held, attachedTo: postId("p-wait") });
    expect(await media.remove(held.id)).toStrictEqual({
      kind: "refused",
      ...refusalView("media_in_use"),
    });
    expect(await media.remove("ghost")).toStrictEqual({
      kind: "refused",
      ...refusalView("not_found"),
    });
  });

  it("serves a thumbnail's bytes with its stored type; an unknown id is not found", async () => {
    const { world, media } = await setup();
    const staged = await world.stage(ACCOUNT, "PHOTO", "m-jpeg");
    const storageKey = await world.blobs.put(JPEG, "image/jpeg");
    await world.media.save({ ...staged, contentType: "image/jpeg", storageKey });
    expect(await media.file("m-jpeg")).toStrictEqual({
      kind: "page",
      view: { bytes: JPEG, contentType: "image/jpeg" },
    });
    expect(await media.file("ghost")).toStrictEqual({
      kind: "refused",
      ...refusalView("not_found"),
    });
  });
});

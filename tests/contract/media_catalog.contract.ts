/** The media catalog's contract (GROKCHAT-18): an account's staged media for list_media. */
import { expect, it } from "vitest";
import { stagedMediaId } from "../../src/entities/identity/ids";
import type { MediaCatalog } from "../../src/use_cases/ports/media_catalog";
import type { MediaRepository } from "../../src/use_cases/ports/media_repository";
import { ACCOUNT, aMedia, OTHER_ACCOUNT, T0 } from "../unit/support/builders";

export interface CatalogStores {
  readonly catalog: MediaCatalog;
  readonly media: MediaRepository;
}

export function mediaCatalogContract(make: () => CatalogStores): void {
  it("lists only the account's media, newest staged first, ties by id descending, at most limit", async () => {
    const { catalog, media } = make();
    const rows = [
      aMedia({ id: stagedMediaId("m-a"), stagedAt: T0 + 5 }),
      aMedia({ id: stagedMediaId("m-c"), stagedAt: T0 + 5 }),
      aMedia({ id: stagedMediaId("m-b"), stagedAt: T0 + 9 }),
      aMedia({ id: stagedMediaId("m-old"), stagedAt: T0 }),
      aMedia({ id: stagedMediaId("m-other"), ownerAccountId: OTHER_ACCOUNT, stagedAt: T0 + 99 }),
    ];
    for (const row of rows) {
      await media.save(row);
    }
    const ids = async (limit: number) =>
      (await catalog.recent(ACCOUNT, limit)).map((item) => String(item.id));
    expect(await ids(10)).toStrictEqual(["m-b", "m-c", "m-a", "m-old"]);
    expect(await ids(2)).toStrictEqual(["m-b", "m-c"]);
    expect(await ids(0)).toStrictEqual([]);
    expect(await ids(-1)).toStrictEqual([]);
    expect((await catalog.recent(OTHER_ACCOUNT, 10)).map((item) => item.id)).toStrictEqual([
      "m-other",
    ]);
  });

  it("returns each item as saved: its label and where it came from (a bot upload too, GROKCHAT-20)", async () => {
    const { catalog, media } = make();
    const upload = aMedia({
      id: stagedMediaId("m-up"),
      label: "launch banner",
      source: { kind: "dashboard" },
      stagedAt: T0 + 1,
    });
    const fetched = aMedia({
      id: stagedMediaId("m-url"),
      source: { kind: "url", host: "imgen.x.ai" },
    });
    const sent = aMedia({
      id: stagedMediaId("m-bot"),
      label: "mascot",
      source: { kind: "bot_upload" },
      stagedAt: T0 - 1,
    });
    await media.save(upload);
    await media.save(fetched);
    await media.save(sent);
    expect(await catalog.recent(ACCOUNT, 10)).toStrictEqual([upload, fetched, sent]);
    expect(await media.get(upload.id)).toStrictEqual(upload);
    expect(await media.get(sent.id)).toStrictEqual(sent);
  });
}

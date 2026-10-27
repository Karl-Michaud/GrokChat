/** Contracts for the account, personality and media repositories, the blob store and R2 usage. */
import { expect, it } from "vitest";
import { accountId, personalityId, stagedMediaId, xUserId } from "../../src/entities/identity/ids";
import type { AccountRepository } from "../../src/use_cases/ports/account_repository";
import type { MediaBlobStore } from "../../src/use_cases/ports/media_blob_store";
import type { MediaRepository } from "../../src/use_cases/ports/media_repository";
import type { MediaUsageRepository } from "../../src/use_cases/ports/media_usage_repository";
import type { PersonalityRepository } from "../../src/use_cases/ports/personality_repository";
import { aMedia, aPersonality, anAccount, T0 } from "../unit/support/builders";

export function accountRepositoryContract(make: () => AccountRepository): void {
  it("save, get, find by X user, list by id; save replaces", async () => {
    const repo = make();
    const b = anAccount({ id: accountId("b"), xUserId: xUserId("xb") });
    const a = anAccount({ id: accountId("a"), xUserId: xUserId("xa") });
    await repo.save(b);
    await repo.save(a);
    expect(await repo.get(accountId("a"))).toStrictEqual(a);
    expect(await repo.get(accountId("z"))).toBeNull();
    expect(await repo.findByXUserId(xUserId("xb"))).toStrictEqual(b);
    expect(await repo.findByXUserId(xUserId("xz"))).toBeNull();
    expect(await repo.list()).toStrictEqual([a, b]);
    await repo.save({ ...a, status: "PAUSED" });
    expect((await repo.get(accountId("a")))?.status).toBe("PAUSED");
  });
}

export function personalityRepositoryContract(make: () => PersonalityRepository): void {
  it("save, get, list by id", async () => {
    const repo = make();
    const b = aPersonality({ id: personalityId("b") });
    const a = aPersonality({ id: personalityId("a") });
    await repo.save(b);
    await repo.save(a);
    expect(await repo.get(personalityId("b"))).toStrictEqual(b);
    expect(await repo.get(personalityId("z"))).toBeNull();
    expect(await repo.list()).toStrictEqual([a, b]);
  });
}

export function mediaRepositoryContract(make: () => MediaRepository): void {
  it("save, get, list by id, delete", async () => {
    const repo = make();
    const b = aMedia({ id: stagedMediaId("b") });
    const a = aMedia({ id: stagedMediaId("a") });
    await repo.save(b);
    await repo.save(a);
    expect(await repo.get(stagedMediaId("a"))).toStrictEqual(a);
    expect(await repo.list()).toStrictEqual([a, b]);
    await repo.delete(stagedMediaId("a"));
    expect(await repo.get(stagedMediaId("a"))).toBeNull();
    expect(await repo.list()).toStrictEqual([b]);
  });
}

export function blobStoreContract(make: () => MediaBlobStore): void {
  it("put returns a fresh key; get returns the bytes; delete removes them", async () => {
    const store = make();
    const bytes = new Uint8Array([1, 2, 3]);
    const key = await store.put(bytes, "image/png");
    const other = await store.put(new Uint8Array([4]), "image/gif");
    expect(key).not.toBe(other);
    expect(await store.get(key)).toStrictEqual(bytes);
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
    expect(await store.get("never")).toBeNull();
  });
}

export function mediaUsageContract(make: () => MediaUsageRepository): void {
  it("counts this month's operations and the stored bytes; a new month resets the operations", async () => {
    const usage = make();
    expect(await usage.current(T0)).toStrictEqual({
      month: "2026-10",
      storedBytes: 0,
      classA: 0,
      classB: 0,
    });
    await usage.record({ storedBytes: 100, classA: 1, classB: 0 }, T0);
    await usage.record({ storedBytes: -40, classA: 0, classB: 2 }, T0);
    expect(await usage.current(T0)).toStrictEqual({
      month: "2026-10",
      storedBytes: 60,
      classA: 1,
      classB: 2,
    });
    const november = Date.UTC(2026, 10, 1);
    expect(await usage.current(november)).toStrictEqual({
      month: "2026-11",
      storedBytes: 60,
      classA: 0,
      classB: 0,
    });
    await usage.record({ storedBytes: 0, classA: 0, classB: 1 }, november);
    expect(await usage.current(november)).toStrictEqual({
      month: "2026-11",
      storedBytes: 60,
      classA: 0,
      classB: 1,
    });
  });
}

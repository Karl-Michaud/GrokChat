import type { Account } from "../../entities/accounts/account";
import type { Personality } from "../../entities/content/personality";
import type { StagedMedia } from "../../entities/content/staged_media";
import type { AccountId, PersonalityId, StagedMediaId, XUserId } from "../../entities/identity/ids";
import type { AccountRepository } from "../../use_cases/ports/account_repository";
import type { MediaRepository } from "../../use_cases/ports/media_repository";
import type { PersonalityRepository } from "../../use_cases/ports/personality_repository";

export class MemoryAccountRepository implements AccountRepository {
  readonly rows = new Map<AccountId, Account>();

  get(id: AccountId): Promise<Account | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  findByXUserId(xUser: XUserId): Promise<Account | null> {
    return Promise.resolve(
      [...this.rows.values()].find((account) => account.xUserId === xUser) ?? null,
    );
  }

  list(): Promise<readonly Account[]> {
    return Promise.resolve([...this.rows.values()].sort((a, b) => a.id.localeCompare(b.id)));
  }

  save(account: Account): Promise<void> {
    this.rows.set(account.id, account);
    return Promise.resolve();
  }
}

export class MemoryPersonalityRepository implements PersonalityRepository {
  readonly rows = new Map<PersonalityId, Personality>();

  get(id: PersonalityId): Promise<Personality | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  list(): Promise<readonly Personality[]> {
    return Promise.resolve([...this.rows.values()].sort((a, b) => a.id.localeCompare(b.id)));
  }

  save(personality: Personality): Promise<void> {
    this.rows.set(personality.id, personality);
    return Promise.resolve();
  }
}

export class MemoryMediaRepository implements MediaRepository {
  readonly rows = new Map<StagedMediaId, StagedMedia>();

  get(id: StagedMediaId): Promise<StagedMedia | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  list(): Promise<readonly StagedMedia[]> {
    return Promise.resolve([...this.rows.values()].sort((a, b) => a.id.localeCompare(b.id)));
  }

  save(media: StagedMedia): Promise<void> {
    this.rows.set(media.id, media);
    return Promise.resolve();
  }

  delete(id: StagedMediaId): Promise<void> {
    this.rows.delete(id);
    return Promise.resolve();
  }
}

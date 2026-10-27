import type { Account, AccountStatus } from "../../entities/accounts/account";
import type { PostingPolicy } from "../../entities/accounts/posting_policy";
import {
  accountId,
  personalityId,
  xUserId,
  type AccountId,
  type XUserId,
} from "../../entities/identity/ids";
import type { AccountRepository } from "../../use_cases/ports/account_repository";

interface AccountRow {
  readonly id: string;
  readonly x_user_id: string;
  readonly handle: string;
  readonly personality_id: string;
  readonly status: string;
  readonly bio_confirmed: number;
  readonly automated_label_confirmed: number;
  readonly policy: string;
  readonly is_app_owner: number;
}

const COLUMNS =
  "id, x_user_id, handle, personality_id, status, bio_confirmed, automated_label_confirmed, " +
  "policy, is_app_owner";

function fromRow(row: AccountRow): Account {
  return {
    id: accountId(row.id),
    xUserId: xUserId(row.x_user_id),
    handle: row.handle,
    personalityId: personalityId(row.personality_id),
    status: row.status as AccountStatus,
    disclosure: {
      bioConfirmed: row.bio_confirmed === 1,
      automatedLabelConfirmed: row.automated_label_confirmed === 1,
    },
    policy: JSON.parse(row.policy) as PostingPolicy,
    isAppOwner: row.is_app_owner === 1,
  };
}

export class D1AccountRepository implements AccountRepository {
  constructor(private readonly db: D1Database) {}

  async get(id: AccountId): Promise<Account | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM accounts WHERE id = ?1`)
      .bind(id)
      .first<AccountRow>();
    return row === null ? null : fromRow(row);
  }

  async findByXUserId(xUser: XUserId): Promise<Account | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM accounts WHERE x_user_id = ?1 ORDER BY id LIMIT 1`)
      .bind(xUser)
      .first<AccountRow>();
    return row === null ? null : fromRow(row);
  }

  async list(): Promise<readonly Account[]> {
    const result = await this.db
      .prepare(`SELECT ${COLUMNS} FROM accounts ORDER BY id`)
      .all<AccountRow>();
    return result.results.map(fromRow);
  }

  async save(account: Account): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO accounts (${COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(
        account.id,
        account.xUserId,
        account.handle,
        account.personalityId,
        account.status,
        account.disclosure.bioConfirmed ? 1 : 0,
        account.disclosure.automatedLabelConfirmed ? 1 : 0,
        JSON.stringify(account.policy),
        account.isAppOwner ? 1 : 0,
      )
      .run();
  }
}

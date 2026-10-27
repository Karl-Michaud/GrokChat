import type { AccountId } from "../../entities/identity/ids";
import type { Instant } from "../../entities/time/instant";
import type { TokenSet } from "../../entities/x/token_set";
import type { StoredTokens, TokenStore } from "../../use_cases/ports/token_store";
import { TokenVaultError, type TokenVault } from "../crypto/token_vault";

/** One storage value per account: the sealed token set and the REFRESHING marker together. */
interface TokenRecord {
  readonly sealed: string;
  readonly refreshingSince: Instant | null;
}

function parseTokens(plaintext: string): TokenSet {
  const value = JSON.parse(plaintext) as Partial<TokenSet>;
  if (
    typeof value.accessToken !== "string" ||
    typeof value.refreshToken !== "string" ||
    typeof value.accessExpiresAt !== "number"
  ) {
    throw new TokenVaultError("the stored token set is malformed");
  }
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    accessExpiresAt: value.accessExpiresAt,
  };
}

/**
 * The account's token set in its Durable Object's SQLite storage, sealed by the vault (plan §3.5,
 * A1, A2). The marker and the tokens are one value, so `commitRotated` clears the marker and writes
 * the rotated tokens in one atomic put. A value sealed under an older key is re-sealed under the
 * newest when it is loaded (rotation).
 */
export class DurableTokenStore implements TokenStore {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly vault: TokenVault,
  ) {}

  async load(account: AccountId): Promise<StoredTokens | null> {
    const record = await this.read(account);
    if (record === null) {
      return null;
    }
    const opened = await this.vault.open(record.sealed, account);
    const tokens = parseTokens(opened.plaintext);
    if (!opened.current) {
      await this.write(account, { ...record, sealed: await this.seal(account, tokens) });
    }
    return { tokens, refreshingSince: record.refreshingSince };
  }

  async markRefreshing(account: AccountId, at: Instant): Promise<void> {
    await this.setMarker(account, at);
  }

  async commitRotated(account: AccountId, tokens: TokenSet): Promise<void> {
    await this.write(account, { sealed: await this.seal(account, tokens), refreshingSince: null });
  }

  async clearMarker(account: AccountId): Promise<void> {
    await this.setMarker(account, null);
  }

  private async setMarker(account: AccountId, at: Instant | null): Promise<void> {
    const record = await this.read(account);
    if (record !== null) {
      await this.write(account, { ...record, refreshingSince: at });
    }
  }

  private seal(account: AccountId, tokens: TokenSet): Promise<string> {
    return this.vault.seal(JSON.stringify(tokens), account);
  }

  private async read(account: AccountId): Promise<TokenRecord | null> {
    return (await this.storage.get<TokenRecord>(`tokens:${account}`)) ?? null;
  }

  private write(account: AccountId, record: TokenRecord): Promise<void> {
    return this.storage.put(`tokens:${account}`, record);
  }
}

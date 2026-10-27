import type { Instant } from "../../entities/time/instant";
import type { OAuthState, OAuthStateStore } from "../../use_cases/ports/oauth_state_store";

interface StateRow {
  readonly verifier: string;
  readonly session_id: string;
  readonly expires_at: number;
}

/** Single-use PKCE state (rev 4 M7): `take` deletes the row in the same statement that reads it. */
export class D1OAuthStateStore implements OAuthStateStore {
  constructor(private readonly db: D1Database) {}

  async put(record: OAuthState): Promise<void> {
    await this.db
      .prepare(
        "INSERT OR REPLACE INTO oauth_states (state, verifier, session_id, expires_at) " +
          "VALUES (?1, ?2, ?3, ?4)",
      )
      .bind(record.state, record.verifier, record.sessionId, record.expiresAt)
      .run();
  }

  async take(state: string, sessionId: string, now: Instant): Promise<string | null> {
    const row = await this.db
      .prepare(
        "DELETE FROM oauth_states WHERE state = ?1 RETURNING verifier, session_id, expires_at",
      )
      .bind(state)
      .first<StateRow>();
    return row?.session_id === sessionId && now < row.expires_at ? row.verifier : null;
  }
}

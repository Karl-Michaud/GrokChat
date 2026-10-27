import type { RefreshResult } from "../../entities/x/refresh_outcome";

/** X's token endpoint (confidential client, U1). No short abort: cutting it off loses the token. */
export interface XTokenRefresher {
  refresh(refreshToken: string): Promise<RefreshResult>;
}

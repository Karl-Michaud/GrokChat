import type { Instant } from "../../entities/time/instant";

/** An upload past its expiry, and the bytes its parts still hold in storage. */
export interface ExpiredUpload {
  readonly id: string;
  readonly partBytes: number;
}

/** What the cleanup needs of the pending uploads (GROKCHAT-20): find the expired, delete them. */
export interface ExpiredUploads {
  /** At most `limit` uploads whose expiry is at or before `now`. */
  expired(now: Instant, limit: number): Promise<readonly ExpiredUpload[]>;
  discard(id: string): Promise<void>;
}

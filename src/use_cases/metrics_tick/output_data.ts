export interface MetricsTickOutputData {
  /** Which cron job ran. */
  readonly job: string;
  readonly dispatched: number;
  readonly waiting: number;
  /** Posts made outside GrokChat found on the accounts' timelines (GROKCHAT-19). */
  readonly imported: number;
  readonly read: number;
  /** Follower snapshots read (GROKCHAT-15): at most one per account per UTC day. */
  readonly followers: number;
  readonly mediaDeleted: number;
}

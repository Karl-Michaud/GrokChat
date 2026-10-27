export interface MetricsTickOutputData {
  /** Which cron job ran. */
  readonly job: string;
  readonly dispatched: number;
  readonly waiting: number;
  readonly read: number;
  readonly mediaDeleted: number;
}

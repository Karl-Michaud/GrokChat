export interface ReconcileTickOutputData {
  /** Which cron job ran. */
  readonly job: string;
  readonly dispatched: number;
  readonly waiting: number;
  readonly found: number;
  readonly notFound: number;
}

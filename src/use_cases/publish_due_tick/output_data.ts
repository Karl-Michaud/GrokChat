export interface PublishDueTickOutputData {
  /** Which cron job ran. */
  readonly job: string;
  readonly dispatched: number;
  /** Accounts left for the next minute: past the fan-out ceiling, or after a stop. */
  readonly waiting: number;
  readonly stoppedForAppLimit: boolean;
}

/**
 * The Cron Trigger entry. It does nothing until PR 6 dispatches the publish, reconcile and metrics
 * ticks by `controller.cron` (plan §3.3, §3.5); wrangler.jsonc declares no crons until then.
 */
export function dispatchScheduled(): Promise<void> {
  return Promise.resolve();
}

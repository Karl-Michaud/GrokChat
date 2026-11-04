import { METRICS_SCHEDULE } from "../../entities/metrics/metrics_due";

/**
 * SQL for when a SENT part's next metrics read falls due: the first schedule point after the
 * latest read (`taken`, NULL when never read), or NULL once every point is read. It is the
 * indexed form of `metricsDue` (entities/metrics/metrics_due): a part is due exactly when this
 * instant has passed, so `accountsNeedingWork` reads an index instead of every snapshot.
 * `sent` is NULL for a part that is not SENT, which makes the whole expression NULL.
 */
export function nextMetricsAtSql(sent: string, taken: string): string {
  const last = `COALESCE(${taken}, -1)`;
  const arms = METRICS_SCHEDULE.map(
    (offset) => `WHEN ${last} < ${sent} + ${String(offset)} THEN ${sent} + ${String(offset)}`,
  );
  return `CASE ${arms.join(" ")} ELSE NULL END`;
}

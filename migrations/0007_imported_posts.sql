-- GROKCHAT-19: posts made outside GrokChat, found on each account's own timeline, so the
-- dashboard can show them and their metrics. Additive: the running release never reads these.

-- One row per post GrokChat did not publish. `metrics_next_at` is the next metrics read due, as
-- on `post_parts` (entities/metrics/metrics_due), so the metrics tick finds them by index.
CREATE TABLE imported_posts (
  x_post_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  in_reply_to_x_post_id TEXT,
  imported_at INTEGER NOT NULL,
  metrics_next_at INTEGER
);
CREATE INDEX imported_posts_account_created ON imported_posts (account_id, created_at);
CREATE INDEX imported_posts_metrics_next ON imported_posts (metrics_next_at)
  WHERE metrics_next_at IS NOT NULL;

-- Where each account's imports stand: the last finished import, and the newest post seen.
CREATE TABLE post_imports (
  account_id TEXT PRIMARY KEY,
  last_run_at INTEGER NOT NULL,
  newest_created_at INTEGER
);

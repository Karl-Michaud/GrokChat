-- GrokChat D1 schema (plan §3.5). Applied with `wrangler d1 migrations apply grokchat`.
-- Instants are integer milliseconds since the Unix epoch, UTC. JSON columns hold entity values.

-- The raising guard of every multi-statement post write: a batch starts by inserting NULL here
-- when the post's version or lifecycle is stale, which fails the whole batch (U15, R21), and
-- ends by emptying the table.
CREATE TABLE version_guard (ok INTEGER NOT NULL);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  publish_at INTEGER NOT NULL,
  resume_at INTEGER,
  -- When a waiting post is next due (entities/posts/due); NULL when it is not waiting.
  due_at INTEGER,
  bot_id TEXT,
  idempotency_key TEXT,
  request_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  provenance TEXT NOT NULL,
  parts TEXT NOT NULL,
  version INTEGER NOT NULL
);
-- NULLs are distinct in a UNIQUE index, so human posts (no bot, no key) never collide.
CREATE UNIQUE INDEX posts_bot_idempotency ON posts (bot_id, idempotency_key);
CREATE INDEX posts_lifecycle_publish_at ON posts (lifecycle, publish_at);
CREATE INDEX posts_lifecycle_due_at ON posts (lifecycle, due_at);
CREATE INDEX posts_account_lifecycle ON posts (account_id, lifecycle);
CREATE INDEX posts_account_due_at ON posts (account_id, due_at);

-- One row per part: the indexed view of `posts.parts`, rewritten with the post in one batch.
CREATE TABLE post_parts (
  post_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  state_kind TEXT NOT NULL,
  -- The send attempt that counts against the cap and the gap (SENDING, SENT, UNKNOWN).
  attempt_at INTEGER,
  x_post_id TEXT,
  sent_at INTEGER,
  -- The next metrics read due for a SENT part (entities/metrics/metrics_due); NULL: none.
  metrics_next_at INTEGER,
  PRIMARY KEY (post_id, idx)
);
CREATE INDEX post_parts_account_attempt ON post_parts (account_id, attempt_at);
CREATE INDEX post_parts_unknown ON post_parts (account_id) WHERE state_kind = 'UNKNOWN';
CREATE INDEX post_parts_metrics_next ON post_parts (metrics_next_at) WHERE metrics_next_at IS NOT NULL;
CREATE INDEX post_parts_x_post ON post_parts (x_post_id) WHERE x_post_id IS NOT NULL;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  x_user_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  personality_id TEXT NOT NULL,
  status TEXT NOT NULL,
  bio_confirmed INTEGER NOT NULL,
  automated_label_confirmed INTEGER NOT NULL,
  policy TEXT NOT NULL,
  is_app_owner INTEGER NOT NULL
);
CREATE INDEX accounts_x_user ON accounts (x_user_id);

CREATE TABLE personalities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  voice_guide TEXT NOT NULL,
  topics TEXT NOT NULL,
  dos TEXT NOT NULL,
  donts TEXT NOT NULL,
  examples TEXT NOT NULL,
  version INTEGER NOT NULL
);

CREATE TABLE staged_media (
  id TEXT PRIMARY KEY,
  owner_account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  staged_at INTEGER NOT NULL,
  attached_to TEXT
);

-- R2 use for the quota guard (plan §3.5): one row; operations count per UTC month.
CREATE TABLE r2_usage (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  month TEXT NOT NULL,
  stored_bytes INTEGER NOT NULL,
  class_a INTEGER NOT NULL,
  class_b INTEGER NOT NULL
);

CREATE TABLE metrics (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  x_post_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  taken_at INTEGER NOT NULL,
  impressions INTEGER NOT NULL,
  likes INTEGER NOT NULL,
  reposts INTEGER NOT NULL,
  replies INTEGER NOT NULL,
  quotes INTEGER NOT NULL,
  bookmarks INTEGER NOT NULL,
  url_link_clicks INTEGER,
  user_profile_clicks INTEGER
);
CREATE INDEX metrics_post_taken ON metrics (x_post_id, taken_at);
CREATE INDEX metrics_account_taken ON metrics (account_id, taken_at);

CREATE TABLE audit_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  account_id TEXT,
  post_id TEXT,
  detail TEXT NOT NULL
);
CREATE INDEX audit_events_account ON audit_events (account_id, seq);
CREATE INDEX audit_events_post ON audit_events (post_id, seq);
CREATE INDEX audit_events_at ON audit_events (at);

CREATE TABLE cost_entries (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  -- NULL: X publishes no price for the call (counted, never guessed).
  micros INTEGER
);
CREATE INDEX cost_entries_at ON cost_entries (at, account_id);

CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  session_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE login_failures (
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX login_failures_key_at ON login_failures (key, at);

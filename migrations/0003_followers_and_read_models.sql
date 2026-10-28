-- GROKCHAT-15: the daily follower snapshot and the dashboard's read models.

-- One row per account and UTC day: the primary key is the "at most one billed User read per
-- account per day" rule. A claim inserts the row before X is called (counts NULL); a read that
-- never left deletes it again; a successful read fills the counts in.
CREATE TABLE follower_snapshots (
  account_id TEXT NOT NULL,
  day TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  taken_at INTEGER,
  followers INTEGER,
  following INTEGER,
  posts INTEGER,
  listed INTEGER,
  PRIMARY KEY (account_id, day)
);
CREATE INDEX follower_snapshots_taken ON follower_snapshots (taken_at) WHERE taken_at IS NOT NULL;

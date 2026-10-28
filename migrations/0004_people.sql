-- GROKCHAT-16: people. Each person runs one Grok bot for their accounts and holds one bot token,
-- kept as its SHA-256 only. An account belongs to at most one person; assigning an account to a
-- person widens that person's token at once, with no reissue. Bot auth reads both per request.
CREATE TABLE people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  token_sha256 TEXT UNIQUE,
  token_created_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Nullable: an account with no person is "Unassigned" and no bot may act on it.
ALTER TABLE accounts ADD COLUMN person_id TEXT;
CREATE INDEX accounts_person ON accounts (person_id) WHERE person_id IS NOT NULL;

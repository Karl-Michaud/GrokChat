-- GROKCHAT-15: Grok owns the personalities and the scripts; GrokChat only posts and schedules
-- (owner, 2026-10-27). Accounts no longer carry a personality, and the table goes.
--
-- Safe on the live database: 0001 put no index, view or trigger on `accounts.personality_id`
-- (SQLite's DROP COLUMN refuses a column any of those uses), and the deployed database holds no
-- account yet. Posts' `provenance` JSON written before this keeps its old `personalityVersion`
-- key, which nothing reads any more.
ALTER TABLE accounts DROP COLUMN personality_id;
DROP TABLE personalities;

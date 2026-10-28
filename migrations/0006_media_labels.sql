-- GROKCHAT-18: images for bots. A dashboard upload carries a label; every item records where it
-- came from ('dashboard', or 'url:<host>' for stage_media_from_url; 'url:' for rows staged before
-- this migration, whose host was not kept). list_media and the Media page read an account's
-- recent items through the index.
ALTER TABLE staged_media ADD COLUMN label TEXT;
ALTER TABLE staged_media ADD COLUMN source TEXT NOT NULL DEFAULT 'url:';
CREATE INDEX staged_media_owner ON staged_media (owner_account_id, staged_at);

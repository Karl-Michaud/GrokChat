-- runs as the owner (postgres); the app connects as grokchat_app
CREATE ROLE grokchat_app LOGIN PASSWORD 'apppw';
CREATE SCHEMA grokchat;
CREATE TABLE grokchat.accounts(id text PRIMARY KEY, publish_lease_until timestamptz, publish_lease_holder text);
CREATE TABLE grokchat.posts(id serial PRIMARY KEY, account_id text REFERENCES grokchat.accounts(id),
  lifecycle text NOT NULL, publish_at timestamptz NOT NULL, resume_at timestamptz,
  lease_until timestamptz, version int NOT NULL DEFAULT 0);
CREATE TABLE grokchat.parts(post_id int REFERENCES grokchat.posts(id), k int, state text NOT NULL DEFAULT 'PENDING',
  attempt_at timestamptz, PRIMARY KEY(post_id, k));
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['accounts','posts','parts'] LOOP
    EXECUTE format('ALTER TABLE grokchat.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY grokchat_app_all ON grokchat.%I TO grokchat_app USING (true) WITH CHECK (true)', t);
  END LOOP; END $$;
GRANT USAGE ON SCHEMA grokchat TO grokchat_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA grokchat TO grokchat_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA grokchat TO grokchat_app;

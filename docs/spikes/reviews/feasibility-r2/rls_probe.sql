-- run: docker exec -i <pg17> psql -U postgres < rls_probe.sql   (results in the round-2 report)
CREATE TABLE public.musechat_users(id int, email text); INSERT INTO public.musechat_users VALUES (1,'a@b');
CREATE FUNCTION public.musechat_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';
CREATE SCHEMA auth; CREATE TABLE auth.users(id int);
CREATE SCHEMA grokchat; CREATE TABLE grokchat.posts(id int primary key, account_id text);
ALTER TABLE grokchat.posts ENABLE ROW LEVEL SECURITY;
CREATE ROLE grokchat_app LOGIN PASSWORD 'x' NOINHERIT;
GRANT USAGE ON SCHEMA grokchat TO grokchat_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA grokchat TO grokchat_app;
INSERT INTO grokchat.posts VALUES (1,'acct1');
SET ROLE grokchat_app;
SELECT count(*) AS visible_rows FROM grokchat.posts;          -- 0
INSERT INTO grokchat.posts VALUES (2,'acct2');                 -- ERROR: violates row-level security policy
SELECT * FROM public.musechat_users;                           -- permission denied
SELECT * FROM auth.users;                                      -- permission denied for schema auth
SELECT public.musechat_fn();                                   -- 1 (EXECUTE granted to PUBLIC by default)
RESET ROLE;
CREATE POLICY grokchat_app_all ON grokchat.posts TO grokchat_app USING (true) WITH CHECK (true);
SET ROLE grokchat_app;
SELECT count(*) FROM grokchat.posts;                           -- 1
RESET ROLE;

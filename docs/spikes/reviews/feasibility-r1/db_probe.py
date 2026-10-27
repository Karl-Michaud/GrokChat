import os, sys, threading, time, collections, psycopg
# The probes ran against throwaway local Docker containers (Postgres + PgBouncer).
# Pass the connection string in the environment; no credential is kept in this file.
DSN = os.environ["PG_DSN"]  # e.g. postgresql://postgres:...@localhost:16432/postgres
PT = None if sys.argv[1] == "none" else int(sys.argv[1])

def conn():
    return psycopg.connect(DSN, prepare_threshold=PT, autocommit=False)

with psycopg.connect(DSN, prepare_threshold=None, autocommit=True) as c:
    c.execute("DROP TABLE IF EXISTS posts; DROP TABLE IF EXISTS tokens")
    c.execute("CREATE TABLE posts(id int primary key, status text, publish_at timestamptz)")
    c.execute("INSERT INTO posts SELECT g,'SCHEDULED', now() - (g||' seconds')::interval FROM generate_series(1,50) g")
    c.execute("CREATE TABLE tokens(account text primary key, tok text, refreshes int default 0)")
    c.execute("INSERT INTO tokens VALUES ('a','expired',0)")

CLAIM = """UPDATE posts SET status='PUBLISHING' WHERE id IN (
  SELECT id FROM posts WHERE status='SCHEDULED' AND publish_at <= now()
  ORDER BY publish_at LIMIT %s FOR UPDATE SKIP LOCKED) RETURNING id"""
claimed = collections.Counter(); errors = []
def claimer():
    try:
        with conn() as c:
            for _ in range(20):  # repeated calls so the same statement runs > prepare_threshold times
                with c.transaction():
                    rows = c.execute(CLAIM, (3,)).fetchall()
                    time.sleep(0.01)
                for (i,) in rows: claimed[i] += 1
    except Exception as e: errors.append(repr(e))
ts = [threading.Thread(target=claimer) for _ in range(8)]
[t.start() for t in ts]; [t.join() for t in ts]
print("claim: distinct", len(claimed), "max per id", max(claimed.values()) if claimed else None, "errors", errors[:2])

# row lock across a transaction: refresh-token serialization
refresh_calls = collections.Counter(); errs2 = []
def refresher(n):
    try:
        with conn() as c:
            with c.transaction():
                tok = c.execute("SELECT tok FROM tokens WHERE account='a' FOR UPDATE").fetchone()[0]
                if tok == "expired":
                    time.sleep(0.3)  # simulate X refresh call while holding lock
                    refresh_calls[n] += 1
                    c.execute("UPDATE tokens SET tok='fresh', refreshes=refreshes+1 WHERE account='a'")
    except Exception as e: errs2.append(repr(e))
ts = [threading.Thread(target=refresher, args=(i,)) for i in range(5)]
[t.start() for t in ts]; [t.join() for t in ts]
with psycopg.connect(DSN, prepare_threshold=None, autocommit=True) as c:
    print("refresh calls", sum(refresh_calls.values()), "db refreshes", c.execute("select refreshes from tokens").fetchone()[0], "errors", errs2[:2])

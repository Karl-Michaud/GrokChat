import threading, time, collections, psycopg
DSN = "postgresql://postgres:pw@localhost:16433/postgres"     # pgbouncer transaction mode, pool 4
DSN1 = "postgresql://postgres:pw@localhost:16434/postgres"    # pgbouncer transaction mode, pool 1
def c(dsn=DSN): return psycopg.connect(dsn, prepare_threshold=None, autocommit=True)

def reset(accounts=10, per=5):
    with c() as k:
        k.execute("DROP SCHEMA IF EXISTS g CASCADE; CREATE SCHEMA g")
        k.execute("""CREATE TABLE g.posts(id serial primary key, account_id text, lifecycle text,
                     publish_at timestamptz, lease_until timestamptz, version int default 0, part_state text default 'PENDING')""")
        k.execute("""INSERT INTO g.posts(account_id, lifecycle, publish_at)
                     SELECT 'acct'||a, 'SCHEDULED', now() - (a*per+p||' seconds')::interval
                     FROM generate_series(1,%s) a, generate_series(1,%s) p""".replace("per", str(per)), (accounts, per))

def try_sql(label, sql):
    with c() as k:
        try: k.execute(sql, {"n": 3}).fetchall(); print(f"[{label}] accepted")
        except Exception as e: print(f"[{label}] REJECTED: {type(e).__name__}: {str(e).splitlines()[0]}")

PLAN_SQL = """UPDATE g.posts SET lifecycle='PUBLISHING', lease_until=now()+interval '90 s', version=version+1
 WHERE id IN (SELECT id FROM g.posts WHERE lifecycle='SCHEDULED' AND publish_at <= now()
   ORDER BY publish_at FOR UPDATE SKIP LOCKED LIMIT %(n)s) AND lifecycle='SCHEDULED' RETURNING id"""
DISTINCT_SQL = """UPDATE g.posts SET lifecycle='PUBLISHING' WHERE id IN (
  SELECT DISTINCT ON (account_id) id FROM g.posts WHERE lifecycle='SCHEDULED' AND publish_at <= now()
  ORDER BY account_id, publish_at FOR UPDATE SKIP LOCKED LIMIT %(n)s) AND lifecycle='SCHEDULED' RETURNING id"""
# Proposed: lock candidates (no DISTINCT) in a CTE, pick one per account outside, guard in-flight accounts.
PROPOSED_SQL = """WITH locked AS (
   SELECT p.id, p.account_id, p.publish_at FROM g.posts p
    WHERE p.lifecycle='SCHEDULED' AND p.publish_at <= now()
      AND NOT EXISTS (SELECT 1 FROM g.posts q WHERE q.account_id=p.account_id AND q.lifecycle='PUBLISHING')
    ORDER BY p.publish_at FOR UPDATE OF p SKIP LOCKED),
 pick AS (SELECT id FROM (SELECT DISTINCT ON (account_id) id, publish_at FROM locked ORDER BY account_id, publish_at) d
          ORDER BY publish_at LIMIT %(n)s)
UPDATE g.posts SET lifecycle='PUBLISHING', lease_until=now()+interval '90 s', version=version+1
 WHERE id IN (SELECT id FROM pick) AND lifecycle='SCHEDULED' RETURNING id, account_id"""

reset()
print("== A. syntax")
try_sql("plan SQL: ... FOR UPDATE SKIP LOCKED LIMIT n", PLAN_SQL)
try_sql("plan + DISTINCT ON (account_id)", DISTINCT_SQL)
try_sql("proposed CTE", PROPOSED_SQL)

print("== B. proposed SQL, 8 concurrent claimers x 10 rounds, 10 accounts x 5 due posts")
reset()
claims = collections.Counter(); per_call_dupe = []; errs = []
def worker():
    try:
        with c() as k:
            for _ in range(10):
                with k.transaction():
                    rows = k.execute(PROPOSED_SQL, {"n": 20}).fetchall()
                    time.sleep(0.005)
                accts = [a for _, a in rows]
                if len(accts) != len(set(accts)): per_call_dupe.append(accts)
                for i, _ in rows: claims[i] += 1
    except Exception as e: errs.append(repr(e))
ts = [threading.Thread(target=worker) for _ in range(8)]; [t.start() for t in ts]; [t.join() for t in ts]
with c() as k:
    inflight = k.execute("SELECT account_id, count(*) FROM g.posts WHERE lifecycle='PUBLISHING' GROUP BY 1 HAVING count(*)>1").fetchall()
print("claimed", len(claims), "max per id", max(claims.values()), "dup account in one call", len(per_call_dupe), "accounts with >1 in flight", inflight, "errors", errs[:1])

print("== C. deterministic two-connection barrier tests")
def barrier_test(label, sql2, background=False, lock_timeout="1s"):
    reset(accounts=3, per=2)
    a = psycopg.connect(DSN, prepare_threshold=None, autocommit=False)   # conn 1: claim, hold tx
    r1 = [r[0] for r in a.execute(PLAN_SQL, {"n": 3}).fetchall()]
    out = {}
    def second():
        b = psycopg.connect(DSN, prepare_threshold=None, autocommit=False)
        b.execute(f"SET LOCAL lock_timeout = '{lock_timeout}'")
        try:
            out["r2"] = [r[0] for r in b.execute(sql2, {"n": 3}).fetchall()]; b.commit()
        except Exception as e: out["err"] = type(e).__name__; b.rollback()
        b.close()
    if background:
        t = threading.Thread(target=second); t.start(); time.sleep(0.5); a.commit(); t.join()
    else:
        second(); a.commit()
    a.close()
    r2 = out.get("r2"); inter = sorted(set(r1) & set(r2 or []))
    verdict = "error " + out["err"] if "err" in out else ("DOUBLE CLAIM " + str(inter) if inter else "disjoint")
    print(f"[{label}] conn1={r1} conn2={r2} -> {verdict}")
barrier_test("C1 positive: SKIP LOCKED, conn2 while conn1 holds", PLAN_SQL)
NO_SKIP = PLAN_SQL.replace(" SKIP LOCKED", "")
barrier_test("C2 neg: SKIP LOCKED removed (conn2 blocks)", NO_SKIP)
barrier_test("C2b SKIP LOCKED removed, conn2 waits for commit", NO_SKIP, background=True, lock_timeout="5s")
NO_LOCK_NO_GUARD = PLAN_SQL.replace(" FOR UPDATE SKIP LOCKED", "").replace(" AND lifecycle='SCHEDULED' RETURNING", " RETURNING")
barrier_test("C3 neg: FOR UPDATE and outer guard removed, conn2 waits", NO_LOCK_NO_GUARD, background=True, lock_timeout="5s")
NO_LOCK_GUARD = PLAN_SQL.replace(" FOR UPDATE SKIP LOCKED", "")
barrier_test("C4: FOR UPDATE removed, outer guard kept, conn2 waits", NO_LOCK_GUARD, background=True, lock_timeout="5s")
NO_SKIP_NO_GUARD = NO_SKIP.replace(" AND lifecycle='SCHEDULED' RETURNING", " RETURNING")
barrier_test("C5: SKIP LOCKED + outer guard removed (FOR UPDATE kept), conn2 waits", NO_SKIP_NO_GUARD, background=True, lock_timeout="5s")

print("== D. advisory locks through the transaction pooler")
K = "SELECT hashtext('grokchat:acct1')"
a = psycopg.connect(DSN, prepare_threshold=None, autocommit=False)
a.execute(f"SELECT pg_advisory_xact_lock(({K}))")
b = psycopg.connect(DSN, prepare_threshold=None, autocommit=False)
got_while_held = b.execute(f"SELECT pg_try_advisory_xact_lock(({K}))").fetchone()[0]; b.rollback()
a.commit()
got_after = b.execute(f"SELECT pg_try_advisory_xact_lock(({K}))").fetchone()[0]; b.commit(); a.close(); b.close()
print("D1 xact lock: other conn while held ->", got_while_held, "; after commit ->", got_after)
# session-level lock through a pool of 1 backend: two different clients share the backend
x = psycopg.connect(DSN1, prepare_threshold=None, autocommit=True); y = psycopg.connect(DSN1, prepare_threshold=None, autocommit=True)
x.execute("SELECT pg_advisory_lock(42)")
print("D2 session lock (pool=1): second client try_lock ->", y.execute("SELECT pg_try_advisory_lock(42)").fetchone()[0], "(True = exclusion broken)")
x.execute("SELECT pg_advisory_unlock_all()"); x.close(); y.close()
# xact lock held across the send: a SENDING write inside that tx is not durable before the send
reset(accounts=1, per=1)
a = psycopg.connect(DSN, prepare_threshold=None, autocommit=False)
a.execute(f"SELECT pg_advisory_xact_lock(({K}))"); a.execute("UPDATE g.posts SET part_state='SENDING'")
with c() as o: seen = o.execute("SELECT part_state FROM g.posts").fetchone()[0]
a.pgconn.finish()   # simulate the function dying mid-send (no commit)
time.sleep(0.5)
with c() as o: after = o.execute("SELECT part_state FROM g.posts").fetchone()[0]
print("D3 SENDING written inside the lock tx: seen by others during send ->", seen, "; after crash ->", after)

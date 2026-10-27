"""Round-3 probes. All app work runs as the non-owner role grokchat_app through PgBouncer (transaction mode)."""
import collections, datetime as dt, subprocess, sys, threading, time
import psycopg
from psycopg_pool import ConnectionPool

APP = "postgresql://grokchat_app:apppw@localhost:16435/postgres"
OWNER = "postgresql://postgres:pw@localhost:16435/postgres"
KW = dict(prepare_threshold=None, autocommit=True)
UTC = dt.timezone.utc
LEASE = dt.timedelta(seconds=180)
def app(): return psycopg.connect(APP, **KW)

CLAIM = """WITH locked AS (
  SELECT p.id, p.account_id, p.publish_at FROM grokchat.posts p
   WHERE p.lifecycle IN ('SCHEDULED','RESUMING') AND coalesce(p.resume_at, p.publish_at) <= %(now)s
   ORDER BY coalesce(p.resume_at, p.publish_at) FOR UPDATE OF p SKIP LOCKED),
pick AS (SELECT id FROM (SELECT DISTINCT ON (account_id) id, publish_at FROM locked
                         ORDER BY account_id, publish_at) d ORDER BY publish_at LIMIT %(n)s)
UPDATE grokchat.posts SET lifecycle='PUBLISHING', lease_until=%(now)s+%(lease)s, version=version+1
 WHERE id IN (SELECT id FROM pick) AND lifecycle IN ('SCHEDULED','RESUMING') RETURNING id, account_id"""

LEASE_SQL = """UPDATE grokchat.accounts SET publish_lease_until=%(until)s, publish_lease_holder=%(holder)s
 WHERE id=%(a)s AND (publish_lease_until IS NULL OR publish_lease_until < %(now)s OR publish_lease_holder=%(holder)s) RETURNING id"""
RELEASE_SQL = """UPDATE grokchat.accounts SET publish_lease_until=NULL, publish_lease_holder=NULL
 WHERE id=%(a)s AND publish_lease_holder=%(holder)s RETURNING id"""

def reset(accounts=10, per=5):
    now = dt.datetime.now(UTC)
    with app() as c, c.transaction():
        c.execute("DELETE FROM grokchat.parts; DELETE FROM grokchat.posts; DELETE FROM grokchat.accounts")
        for a in range(1, accounts + 1):
            c.execute("INSERT INTO grokchat.accounts(id) VALUES (%s)", (f"acct{a}",))
            for p in range(per):
                pub = now - dt.timedelta(minutes=10, seconds=a * per + p)
                if p == per - 1:   # a RESUMING post that is not due yet (resume_at in the future)
                    c.execute("INSERT INTO grokchat.posts(account_id, lifecycle, publish_at, resume_at) VALUES (%s,'RESUMING',%s,%s)",
                              (f"acct{a}", pub, now + dt.timedelta(hours=1)))
                elif p == per - 2: # a RESUMING post that is due
                    c.execute("INSERT INTO grokchat.posts(account_id, lifecycle, publish_at, resume_at) VALUES (%s,'RESUMING',%s,%s)",
                              (f"acct{a}", pub, now - dt.timedelta(seconds=5)))
                else:
                    c.execute("INSERT INTO grokchat.posts(account_id, lifecycle, publish_at) VALUES (%s,'SCHEDULED',%s)", (f"acct{a}", pub))
            c.execute("INSERT INTO grokchat.parts(post_id, k) SELECT id, 1 FROM grokchat.posts WHERE account_id=%s", (f"acct{a}",))

def section(t): print(f"\n== {t}")

# ---------------- (a) claim SQL ----------------
section("(a) rev-3 claim SQL as grokchat_app, 8 threads x 10 rounds, 10 accounts x (3 SCHEDULED + 1 RESUMING due + 1 RESUMING not due)")
reset()
claims = collections.Counter(); per_call_dupe = []; errs = []; calls = []
def claimer():
    try:
        with app() as c:
            for _ in range(10):
                with c.transaction():
                    rows = c.execute(CLAIM, {"now": dt.datetime.now(UTC), "n": 20, "lease": LEASE}).fetchall()
                    time.sleep(0.003)
                accts = [a for _, a in rows]; calls.append(len(rows))
                if len(accts) != len(set(accts)): per_call_dupe.append(accts)
                for i, _ in rows: claims[i] += 1
    except Exception as e: errs.append(repr(e))
ts = [threading.Thread(target=claimer) for _ in range(8)]; [t.start() for t in ts]; [t.join() for t in ts]
with app() as c:
    due = c.execute("SELECT count(*) FROM grokchat.posts WHERE coalesce(resume_at, publish_at) <= now()").fetchone()[0]
    not_due_claimed = c.execute("SELECT count(*) FROM grokchat.posts WHERE resume_at > now() AND lifecycle='PUBLISHING'").fetchone()[0]
    inflight = c.execute("SELECT max(n) FROM (SELECT count(*) n FROM grokchat.posts WHERE lifecycle='PUBLISHING' GROUP BY account_id) s").fetchone()[0]
print(f"due={due} claimed={len(claims)} max claims per id={max(claims.values())} calls returning rows={sum(1 for n in calls if n)}"
      f" per-call duplicate account={len(per_call_dupe)} not-due claimed={not_due_claimed} errors={errs[:1]}")
print(f"max posts PUBLISHING at once for one account after all rounds = {inflight}  (no in-flight guard: >1 across calls; AccountLease must serialise)")

# deterministic exactly-once barrier with the rev-3 SQL, and its negative control
def barrier(label, sql):
    reset(accounts=3, per=2)
    a = psycopg.connect(APP, prepare_threshold=None, autocommit=False)
    r1 = [r[0] for r in a.execute(sql, {"now": dt.datetime.now(UTC), "n": 3, "lease": LEASE}).fetchall()]
    out = {}
    def second():
        with psycopg.connect(APP, prepare_threshold=None, autocommit=False) as b:
            b.execute("SET LOCAL lock_timeout='5s'")
            out["r2"] = [r[0] for r in b.execute(sql, {"now": dt.datetime.now(UTC), "n": 3, "lease": LEASE}).fetchall()]; b.commit()
    t = threading.Thread(target=second); t.start(); time.sleep(0.4); a.commit(); a.close(); t.join()
    both = sorted(set(r1) & set(out["r2"]))
    print(f"[{label}] conn1={r1} conn2={out['r2']} -> {'DOUBLE CLAIM '+str(both) if both else 'disjoint'}")
barrier("barrier, rev-3 SQL", CLAIM)
barrier("negative control: FOR UPDATE + outer guard removed",
        CLAIM.replace(" FOR UPDATE OF p SKIP LOCKED", "").replace(" AND lifecycle IN ('SCHEDULED','RESUMING') RETURNING", " RETURNING"))

# ---------------- (b) AccountLease ----------------
section("(b) AccountLease conditional UPDATE")
reset(accounts=1, per=1)
now = dt.datetime.now(UTC); A = "acct1"
won = []; start = threading.Barrier(8)
def racer(h):
    with app() as c:
        start.wait()
        if c.execute(LEASE_SQL, {"a": A, "holder": h, "until": now + LEASE, "now": dt.datetime.now(UTC)}).fetchone(): won.append(h)
ts = [threading.Thread(target=racer, args=(f"w{i}",)) for i in range(8)]; [t.start() for t in ts]; [t.join() for t in ts]
print("8 concurrent acquirers ->", len(won), "acquired:", won)
holder = won[0]
# deterministic: conn1 acquires inside an open tx, conn2 tries meanwhile (blocks), conn1 commits
with app() as c: c.execute("UPDATE grokchat.accounts SET publish_lease_until=NULL, publish_lease_holder=NULL")
a = psycopg.connect(APP, prepare_threshold=None, autocommit=False)
r1 = a.execute(LEASE_SQL, {"a": A, "holder": "h1", "until": now + LEASE, "now": now}).fetchone()
out = {}
def second():
    with app() as c: out["r2"] = c.execute(LEASE_SQL, {"a": A, "holder": "h2", "until": now + LEASE, "now": now}).fetchone()
t = threading.Thread(target=second); t.start(); time.sleep(0.4); a.commit(); a.close(); t.join()
print("barrier: h1 ->", r1, "; h2 after h1 commits ->", out["r2"])
with app() as c:
    renew = c.execute(LEASE_SQL, {"a": A, "holder": "h1", "until": now + 2 * LEASE, "now": now + dt.timedelta(seconds=60)}).fetchone()
    other = c.execute(LEASE_SQL, {"a": A, "holder": "h3", "until": now + LEASE, "now": now + dt.timedelta(seconds=60)}).fetchone()
    bad_release = c.execute(RELEASE_SQL, {"a": A, "holder": "h3"}).fetchone()
    reclaim = c.execute(LEASE_SQL, {"a": A, "holder": "h3", "until": now + 4 * LEASE, "now": now + 3 * LEASE}).fetchone()
    old_renew = c.execute(LEASE_SQL, {"a": A, "holder": "h1", "until": now + 5 * LEASE, "now": now + 3 * LEASE}).fetchone()
print("holder renews before expiry ->", renew, "; other holder before expiry ->", other,
      "; non-holder release ->", bad_release, "; other holder after expiry ->", reclaim, "; old holder after takeover ->", old_renew)
neg = LEASE_SQL.replace(" AND (publish_lease_until IS NULL OR publish_lease_until < %(now)s OR publish_lease_holder=%(holder)s)", "")
with app() as c: c.execute("UPDATE grokchat.accounts SET publish_lease_until=NULL, publish_lease_holder=NULL")
won.clear(); start = threading.Barrier(8)
def racer_neg(h):
    with app() as c:
        start.wait()
        if c.execute(neg, {"a": A, "holder": h, "until": now + LEASE, "now": now}).fetchone(): won.append(h)
ts = [threading.Thread(target=racer_neg, args=(f"w{i}",)) for i in range(8)]; [t.start() for t in ts]; [t.join() for t in ts]
print("negative control (lease WHERE removed): 8 acquirers ->", len(won), "acquired")

# ---------------- (c) reserve_part ----------------
section("(c) reserve_part: SENDING committed and visible before the stubbed send, no transaction open during it")
reset(accounts=1, per=1)
pool = ConnectionPool(APP, min_size=0, max_size=4, check=ConnectionPool.check_connection, kwargs=KW, open=True)
with app() as c:
    pid, = c.execute("UPDATE grokchat.posts SET lifecycle='PUBLISHING', lease_until=now()+interval '180 s', version=version+1 RETURNING id").fetchone()
def reserve_part(conn, post_id, k, holder):
    now = dt.datetime.now(UTC)
    with conn.transaction():
        if not conn.execute(LEASE_SQL, {"a": A, "holder": holder, "until": now + LEASE, "now": now}).fetchone(): return "lease"
        v = conn.execute("UPDATE grokchat.posts SET lease_until=%s, version=version+1 WHERE id=%s AND lifecycle='PUBLISHING' RETURNING version",
                         (now + LEASE, post_id)).fetchone()
        if not v: return "conflict"
        conn.execute("UPDATE grokchat.parts SET state='SENDING', attempt_at=%s WHERE post_id=%s AND k=%s AND state='PENDING'", (now, post_id, k))
    return "reserved"
observed = {}
def stub_send(conn):
    observed["tx_status_during_send"] = conn.info.transaction_status.name
    with psycopg.connect(OWNER, **KW) as other:   # second connection
        observed["part_seen_by_other"] = other.execute("SELECT state FROM grokchat.parts WHERE post_id=%s AND k=1", (pid,)).fetchone()[0]
        observed["idle_in_tx_app_sessions"] = other.execute(
            "SELECT count(*) FROM pg_stat_activity WHERE usename='grokchat_app' AND state LIKE 'idle in transaction%%'").fetchone()[0]
    return "x123"
with pool.connection() as conn:
    print("reserve ->", reserve_part(conn, pid, 1, "tickA"))
    x_id = stub_send(conn)
    with conn.transaction():
        conn.execute("UPDATE grokchat.parts SET state='SENT' WHERE post_id=%s AND k=1 AND state='SENDING'", (pid,))
print("during send:", observed)
# negative control: send inside the reserve transaction -> second connection still sees PENDING
reset(accounts=1, per=1)
with app() as c:
    pid, = c.execute("UPDATE grokchat.posts SET lifecycle='PUBLISHING' RETURNING id").fetchone()
with pool.connection() as conn:
    with conn.transaction():
        conn.execute("UPDATE grokchat.parts SET state='SENDING' WHERE post_id=%s AND k=1", (pid,))
        stub_send(conn)
print("negative control (send inside the tx):", observed)

# ---------------- (d) psycopg_pool ----------------
section("(d) psycopg_pool(min_size=0, max_size=4, check=check_connection, kwargs) through PgBouncer, 16 threads x 25 units")
units = []; lock = threading.Lock(); errs = []
def worker():
    try:
        for _ in range(25):
            with pool.connection() as conn:
                with conn.transaction():
                    t1 = conn.execute("SELECT txid_current()").fetchone()[0]
                    time.sleep(0.002)
                    t2 = conn.execute("SELECT txid_current()").fetchone()[0]
                start = time.perf_counter()
                with conn.transaction():
                    t3 = conn.execute("SELECT txid_current()").fetchone()[0]
                end = time.perf_counter()
                with lock: units.append((id(conn), threading.get_ident(), t1, t2, t3, start, end,
                                         conn.autocommit, conn.prepare_threshold))
    except Exception as e: errs.append(repr(e))
ts = [threading.Thread(target=worker) for _ in range(16)]; [t.start() for t in ts]; [t.join() for t in ts]
same_tx_within = all(u[2] == u[3] for u in units)
txids = [u[2] for u in units] + [u[4] for u in units]
distinct = len(set(txids)) == len(txids)
by_conn = collections.defaultdict(list)
for u in units: by_conn[u[0]].append((u[5], u[6], u[1]))
overlap = 0
for spans in by_conn.values():
    spans.sort()
    for (s1, e1, th1), (s2, e2, th2) in zip(spans, spans[1:]):
        if s2 < e1 and th1 != th2: overlap += 1
print(f"units={len(units)} errors={errs[:1]} conns used={len(by_conn)} (max_size 4) stmts in one tx share txid={same_tx_within}"
      f" all tx ids distinct={distinct} cross-thread overlap on one conn={overlap}"
      f" autocommit={set(u[7] for u in units)} prepare_threshold={set(u[8] for u in units)} pool stats={ {k: v for k, v in pool.get_stats().items() if k in ('pool_min','pool_max','pool_size','connections_num','requests_num','requests_waiting')} }")
# check= after the pooler drops every server and client connection
subprocess.run(["docker", "restart", "fz3-bouncer"], check=True, capture_output=True); time.sleep(2)
try:
    with pool.connection() as conn: ok = conn.execute("SELECT 1").fetchone()[0]
    print("after PgBouncer restart, next pool.connection() works:", ok == 1, "| stats:", {k: v for k, v in pool.get_stats().items() if 'bad' in k or 'lost' in k or k == 'connections_lost'})
except Exception as e: print("after PgBouncer restart: FAILED", repr(e))
pool.close()

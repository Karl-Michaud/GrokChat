import { D1AccountOwners } from "./d1_account_owners";
import { D1AccountRepository } from "./d1_account_repository";
import { D1ActivityLog } from "./d1_activity_log";
import { D1AuditLog } from "./d1_audit_log";
import { D1CostLedger } from "./d1_cost_ledger";
import { D1FollowerStore } from "./d1_follower_store";
import { D1LoginThrottle } from "./d1_login_throttle";
import { D1MediaCatalog } from "./d1_media_catalog";
import { D1MediaCleanupCandidates } from "./d1_media_cleanup_candidates";
import { D1MediaRepository } from "./d1_media_repository";
import { D1MediaUsage } from "./d1_media_usage";
import { D1MetricsRepository } from "./d1_metrics_repository";
import { D1OAuthStateStore } from "./d1_oauth_state_store";
import { D1PersonRepository } from "./d1_person_repository";
import { D1PostReader } from "./d1_post_reader";
import { D1PostWriter } from "./d1_post_writer";

/**
 * Every D1 repository over one database binding, for the composition root (the Worker and the
 * account's Durable Object build the same set, m6). Read replication stays off: no D1 Sessions
 * API, so a read before a SENDING write always sees the primary (plan §3.5, m5).
 */
export function d1Stores(db: D1Database) {
  const reader = new D1PostReader(db);
  return {
    reader,
    writer: new D1PostWriter(db, reader),
    accounts: new D1AccountRepository(db),
    people: new D1PersonRepository(db),
    owners: new D1AccountOwners(db),
    media: new D1MediaRepository(db),
    catalog: new D1MediaCatalog(db),
    cleanupCandidates: new D1MediaCleanupCandidates(db),
    usage: new D1MediaUsage(db),
    metrics: new D1MetricsRepository(db),
    followers: new D1FollowerStore(db),
    audit: new D1AuditLog(db),
    activity: new D1ActivityLog(db),
    costs: new D1CostLedger(db),
    states: new D1OAuthStateStore(db),
    throttle: new D1LoginThrottle(db),
  };
}

export type D1Stores = ReturnType<typeof d1Stores>;

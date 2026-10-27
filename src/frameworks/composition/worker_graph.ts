/**
 * The Worker's production graph (plan §3, §3.5): one set of drivers and shared services over this
 * env's bindings, which the MCP tools and the dashboard both run on. D1 holds every record; the
 * account's Durable Object (`AccountObjects`) does every publish, X delete and token write; R2
 * holds the media. Nothing here is an in-memory stub (tests/integration/production_graph.test.ts).
 */
import { WebCryptoContentHasher } from "../crypto/sha256_hasher";
import { d1Stores } from "../d1/d1_stores";
import { AccountObjects } from "../durable_objects/account_client";
import { SystemClock } from "../durable_objects/system_clock";
import type { Env } from "../env";
import { HttpsMediaFetcher } from "../media_fetch/https_media_fetcher";
import { R2MediaBlobStore } from "../r2/r2_media_blob_store";
import { RandomIds } from "../runtime/random_ids";
import { AuditedXAccountConnector } from "../x_auth/recorded_oauth";
import { XTokenEndpoint } from "../x_auth/token_endpoint";
import { WebCryptoPkce } from "../x_auth/webcrypto_pkce";
import { HttpXAccountConnector } from "../x_auth/x_account_connector_driver";
import { xOAuthConfig } from "../x_auth/x_oauth_config";
import { FetchTransport } from "../x_http/transport";
import { AccessGuard } from "../../use_cases/access/access_guard";
import { ActionAudit } from "../../use_cases/access/action_audit";
import { AccountCommand } from "../../use_cases/admin/account_command";
import { MediaAttachments } from "../../use_cases/authoring/media_attachments";
import { PartsValidator } from "../../use_cases/authoring/parts_validator";
import { PostCommand } from "../../use_cases/authoring/post_command";
import { MediaIntake } from "../../use_cases/media/media_intake";
import type { AuditLog } from "../../use_cases/ports/audit_log";
import type { Clock } from "../../use_cases/ports/clock";
import type { XAccountConnector } from "../../use_cases/ports/x_account_connector";
import { GuardedTransition } from "../../use_cases/run_services/guarded_transition";

/** `GROKCHAT_MEDIA_HOSTS` (plan §3.6): comma-separated, case-insensitive; unset allows no host. */
export function mediaHosts(env: Env): readonly string[] {
  return (env.GROKCHAT_MEDIA_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
}

/** The X OAuth connector, built when a connect starts or finishes: its secrets fail loudly there. */
function xConnector(env: Env, audit: AuditLog, clock: Clock): XAccountConnector {
  const config = xOAuthConfig(env);
  const transport = new FetchTransport();
  const endpoint = new XTokenEndpoint(transport, config);
  const http = new HttpXAccountConnector(config, endpoint, transport, clock);
  return new AuditedXAccountConnector(http, audit, clock);
}

/** The drivers: D1, the account objects, R2, media fetching, ids, the clock. */
function workerDrivers(env: Env) {
  const allowedHosts = mediaHosts(env);
  return {
    ...d1Stores(env.DB),
    clock: new SystemClock(),
    ids: new RandomIds(),
    /** The account's Durable Object: `AccountPublisher` and `AccountXGateway` in one client. */
    objects: new AccountObjects(env.ACCOUNT),
    blobs: new R2MediaBlobStore(env.MEDIA),
    allowedHosts,
    fetcher: new HttpsMediaFetcher(allowedHosts),
    hasher: new WebCryptoContentHasher(),
    pkce: new WebCryptoPkce(),
  };
}

/** Built once per env (per isolate) by main.ts; read by the MCP tools and the dashboard. */
export function workerGraph(env: Env) {
  const drivers = workerDrivers(env);
  const { clock, reader, accounts, media } = drivers;
  const actionAudit = new ActionAudit(drivers.audit, clock);
  const guard = new AccessGuard(actionAudit);
  const steps = new GuardedTransition(drivers.writer);
  return {
    ...drivers,
    actionAudit,
    guard,
    steps,
    command: new PostCommand(reader, steps, guard, actionAudit),
    accountCommand: new AccountCommand(accounts, guard, actionAudit),
    validator: new PartsValidator(media),
    attachments: new MediaAttachments(media),
    intake: new MediaIntake({ ...drivers, audit: actionAudit }),
    connector: (): XAccountConnector => xConnector(env, drivers.audit, clock),
  };
}

export type WorkerGraph = ReturnType<typeof workerGraph>;

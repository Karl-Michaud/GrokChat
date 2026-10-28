/**
 * Every in-memory stub and every run service, wired the way the composition root will wire the
 * real drivers. Tests build interactors on top of it with a capturing presenter.
 */
import type { Account } from "../../../src/entities/accounts/account";
import type { MediaKind, StagedMedia } from "../../../src/entities/content/staged_media";
import { stagedMediaId, type AccountId } from "../../../src/entities/identity/ids";
import { HOUR } from "../../../src/entities/time/instant";
import {
  FakeXMediaUploader,
  FakeXMetrics,
  FakeXUserMetrics,
  FakeXPublisher,
  FakeXTimeline,
  FakeXWorld,
} from "../../../src/frameworks/memory/fake_x";
import {
  InProcessAccountPublisher,
  InProcessAccountReconciler,
  InProcessMetricsCollector,
} from "../../../src/frameworks/memory/in_process_account";
import { ManualClock, SequentialIds } from "../../../src/frameworks/memory/manual_clock";
import {
  MemoryLoginThrottle,
  MemoryOAuthStateStore,
  SequentialPkce,
  StubXAccountConnector,
} from "../../../src/frameworks/memory/memory_auth";
import {
  MemoryLocks,
  MemorySingleFlight,
} from "../../../src/frameworks/durable_objects/object_locks";
import { NoLocks } from "../../../src/frameworks/memory/memory_locks";
import {
  FnvContentHasher,
  MemoryMediaBlobStore,
  MemoryMediaUsage,
  ScriptedMediaFetcher,
} from "../../../src/frameworks/memory/memory_media";
import {
  MemoryPostReader,
  MemoryPostTable,
  MemoryPostWriter,
} from "../../../src/frameworks/memory/memory_post_store";
import {
  MemoryAuditLog,
  MemoryCostLedger,
  MemoryMetricsRepository,
} from "../../../src/frameworks/memory/memory_records";
import {
  MemoryAccountRepository,
  MemoryMediaRepository,
} from "../../../src/frameworks/memory/memory_repositories";
import {
  MemoryAccountOwners,
  MemoryPersonRepository,
  SequentialTokenIssuer,
} from "../../../src/frameworks/memory/memory_people";
import { MemoryActivityLog } from "../../../src/frameworks/memory/memory_activity";
import { MemoryFollowerStore } from "../../../src/frameworks/memory/memory_followers";
import { FakeXTokenEndpoint, MemoryTokenStore } from "../../../src/frameworks/memory/memory_tokens";
import { AccessGuard } from "../../../src/use_cases/access/access_guard";
import { ActionAudit } from "../../../src/use_cases/access/action_audit";
import { AccountCommand } from "../../../src/use_cases/admin/account_command";
import { MediaAttachments } from "../../../src/use_cases/authoring/media_attachments";
import { PartsValidator } from "../../../src/use_cases/authoring/parts_validator";
import { PostCommand } from "../../../src/use_cases/authoring/post_command";
import { MediaIntake } from "../../../src/use_cases/media/media_intake";
import type { Locks } from "../../../src/use_cases/ports/locks";
import { AccountRecovery } from "../../../src/use_cases/run_services/account_recovery";
import { AccountXGatewayService } from "../../../src/use_cases/run_services/account_x_gateway_service";
import { PostsThenFollowers } from "../../../src/use_cases/run_services/account_metrics_run";
import { CollectAccountMetrics } from "../../../src/use_cases/run_services/collect_account_metrics";
import { GuardedTransition } from "../../../src/use_cases/run_services/guarded_transition";
import { MediaCleanup } from "../../../src/use_cases/run_services/media_cleanup";
import { MemoryMediaCleanupCandidates } from "../../../src/frameworks/memory/memory_media_cleanup";
import { MemoryMediaCatalog } from "../../../src/frameworks/memory/memory_media_catalog";
import { MediaStager } from "../../../src/use_cases/run_services/media_stager";
import { PartSender } from "../../../src/use_cases/run_services/part_sender";
import { PublishPost } from "../../../src/use_cases/run_services/publish_post";
import { ReconcileAccount } from "../../../src/use_cases/run_services/reconcile_account";
import { RefreshingTokenProvider } from "../../../src/use_cases/run_services/refreshing_token_provider";
import { SnapshotFollowers } from "../../../src/use_cases/run_services/snapshot_followers";
import { TokenStep } from "../../../src/use_cases/run_services/token_step";
import { XCallRecorder } from "../../../src/use_cases/run_services/x_call_recorder";
import { anAccount, T0 } from "./builders";

/** A presenter that keeps what it was given. */
export class Capture<T> {
  readonly outputs: T[] = [];

  present(output: T): void {
    this.outputs.push(output);
  }

  get last(): T {
    const last = this.outputs.at(-1);
    if (last === undefined) {
      throw new Error("nothing presented");
    }
    return last;
  }
}

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
export const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3]);

export function makeWorld(options: { readonly locks?: "mutex" | "none" } = {}) {
  const clock = new ManualClock(T0);
  const ids = new SequentialIds("id");
  const audit = new MemoryAuditLog();
  const costs = new MemoryCostLedger();
  const metrics = new MemoryMetricsRepository();
  const activity = new MemoryActivityLog(audit, costs);
  const table = new MemoryPostTable();
  const reader = new MemoryPostReader(table, metrics);
  const writer = new MemoryPostWriter(table, audit, costs);
  const accounts = new MemoryAccountRepository();
  const media = new MemoryMediaRepository();
  const catalog = new MemoryMediaCatalog(media);
  const blobs = new MemoryMediaBlobStore();
  const usage = new MemoryMediaUsage();
  const fetcher = new ScriptedMediaFetcher();
  const hasher = new FnvContentHasher();
  const locks: Locks = options.locks === "none" ? new NoLocks() : new MemoryLocks(clock, clock);
  const flights = new MemorySingleFlight();
  const tokenStore = new MemoryTokenStore();
  const tokenEndpoint = new FakeXTokenEndpoint(clock);
  const x = new FakeXWorld(clock);
  const xPublisher = new FakeXPublisher(x);
  const uploader = new FakeXMediaUploader(x);
  const timeline = new FakeXTimeline(x);
  const xMetrics = new FakeXMetrics(x);
  const xUsers = new FakeXUserMetrics(x);
  const followers = new MemoryFollowerStore(accounts);
  const states = new MemoryOAuthStateStore();
  const throttle = new MemoryLoginThrottle();
  const pkce = new SequentialPkce();
  const connector = new StubXAccountConnector();

  const recorder = new XCallRecorder(audit, costs);
  const steps = new GuardedTransition(writer);
  const tokens = new RefreshingTokenProvider(tokenStore, tokenEndpoint, locks, clock);
  const tokenStep = new TokenStep(tokens, clock);
  const stager = new MediaStager({ media, blobs, usage, uploader, recorder });
  const sender = new PartSender({
    reader,
    accounts,
    tokens,
    publisher: xPublisher,
    stager,
    recorder,
    steps,
    clock,
  });
  const recovery = new AccountRecovery(reader, writer);
  const publishPost = new PublishPost({ reader, accounts, locks, clock, recovery, steps, sender });
  const accountPublisher = new InProcessAccountPublisher(publishPost);
  const reconcileAccount = new ReconcileAccount({
    reader,
    accounts,
    timeline,
    tokenStep,
    recorder,
    steps,
    flights,
    clock,
  });
  const reconciler = new InProcessAccountReconciler(reconcileAccount);
  const collectMetrics = new CollectAccountMetrics({
    reader,
    accounts,
    metrics,
    x: xMetrics,
    tokenStep,
    recorder,
    flights,
    clock,
  });
  const snapshotFollowers = new SnapshotFollowers({
    accounts,
    days: followers,
    x: xUsers,
    tokenStep,
    recorder,
    flights,
    clock,
  });
  const collector = new InProcessMetricsCollector(
    new PostsThenFollowers(collectMetrics, snapshotFollowers),
  );
  const gateway = new AccountXGatewayService({
    publisher: xPublisher,
    store: tokenStore,
    locks,
    recorder,
    clock,
  });
  const cleanupCandidates = new MemoryMediaCleanupCandidates(media, reader);
  const cleanup = new MediaCleanup({
    media,
    candidates: cleanupCandidates,
    blobs,
    usage,
    clock,
  });

  const actionAudit = new ActionAudit(audit, clock);
  const guard = new AccessGuard(actionAudit);
  const validator = new PartsValidator(media);
  const attachments = new MediaAttachments(media);
  const command = new PostCommand(reader, steps, guard, actionAudit);
  const accountCommand = new AccountCommand(accounts, guard, actionAudit);
  const intake = new MediaIntake({ media, blobs, usage, hasher, audit: actionAudit, ids, clock });
  const owners = new MemoryAccountOwners(accounts);
  const people = new MemoryPersonRepository(owners);
  const issuer = new SequentialTokenIssuer();

  /** An active, disclosed account with tokens valid for two hours. */
  async function seedAccount(overrides: Partial<Account> = {}): Promise<Account> {
    const account = anAccount(overrides);
    await accounts.save(account);
    await tokenStore.commitRotated(account.id, tokenEndpoint.issue());
    return account;
  }

  async function stage(
    account: AccountId,
    kind: MediaKind = "PHOTO",
    id = `m-${ids.newId()}`,
  ): Promise<StagedMedia> {
    const bytes = kind === "GIF" ? GIF : PNG;
    const storageKey = await blobs.put(bytes, kind === "GIF" ? "image/gif" : "image/png");
    const item: StagedMedia = {
      id: stagedMediaId(id),
      ownerAccountId: account,
      kind,
      contentType: kind === "GIF" ? "image/gif" : "image/png",
      size: bytes.length,
      storageKey,
      sha256: "s",
      stagedAt: clock.now(),
      attachedTo: null,
      label: null,
      source: { kind: "dashboard" },
    };
    await media.save(item);
    return item;
  }

  return {
    clock,
    ids,
    owners,
    people,
    issuer,
    audit,
    costs,
    metrics,
    activity,
    table,
    reader,
    writer,
    accounts,
    media,
    catalog,
    blobs,
    usage,
    fetcher,
    hasher,
    locks,
    flights,
    tokenStore,
    tokenEndpoint,
    x,
    xPublisher,
    uploader,
    timeline,
    xMetrics,
    xUsers,
    followers,
    states,
    throttle,
    pkce,
    connector,
    recorder,
    steps,
    tokens,
    tokenStep,
    stager,
    sender,
    recovery,
    publishPost,
    accountPublisher,
    reconcileAccount,
    reconciler,
    collectMetrics,
    snapshotFollowers,
    collector,
    gateway,
    cleanup,
    cleanupCandidates,
    actionAudit,
    guard,
    validator,
    attachments,
    command,
    accountCommand,
    intake,
    seedAccount,
    stage,
  };
}

export type World = ReturnType<typeof makeWorld>;

export const TOKENS_VALID_FOR = 2 * HOUR;

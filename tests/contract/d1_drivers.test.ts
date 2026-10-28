/** Every D1 driver against its port's contract, in workerd with a real local D1 (plan §6). */
import { env } from "cloudflare:workers";
import { beforeEach, describe } from "vitest";
import { WebCryptoBotTokenIssuer } from "../../src/frameworks/crypto/bot_token_issuer";
import { d1Stores } from "../../src/frameworks/d1/d1_stores";
import { freshStorage } from "../integration/support/fresh_d1";
import { followerStoreContract } from "./followers.contract";
import { importedPostsContract } from "./imported_posts.contract";
import { mediaCatalogContract } from "./media_catalog.contract";
import { mediaCleanupCandidatesContract } from "./media_cleanup.contract";
import {
  accountOwnersContract,
  personRepositoryContract,
  tokenIssuerContract,
} from "./people.contract";
import { postStoreContract } from "./post_store.contract";
import {
  activityLogContract,
  followerHistoryContract,
  metricsHistoryContract,
} from "./read_models.contract";
import {
  auditLogContract,
  costLedgerContract,
  loginThrottleContract,
  metricsRepositoryContract,
  oauthStateContract,
} from "./records.contract";
import {
  accountRepositoryContract,
  mediaRepositoryContract,
  mediaUsageContract,
} from "./repositories.contract";

beforeEach(freshStorage);

const stores = () => d1Stores(env.DB);

describe("D1 post store", () => {
  postStoreContract(() => {
    const { reader, writer, audit, costs } = stores();
    return { reader, writer, audit, costs };
  });
});

describe("D1 cleanup candidates", () => {
  mediaCleanupCandidatesContract(() => {
    const { cleanupCandidates, media, writer } = stores();
    return { candidates: cleanupCandidates, media, writer };
  });
});

describe("D1 repositories", () => {
  accountRepositoryContract(() => stores().accounts);
  mediaRepositoryContract(() => stores().media);
  mediaCatalogContract(stores);
  mediaUsageContract(() => stores().usage);
});

describe("D1 follower store", () => {
  followerStoreContract(() => ({ store: stores().followers, accounts: stores().accounts }));
});

describe("D1 imported posts (GROKCHAT-19)", () => {
  importedPostsContract(() => {
    const { imported, accounts, writer, metrics } = stores();
    return { store: imported, accounts, writer, metrics };
  });
});

describe("D1 read models (GROKCHAT-15)", () => {
  metricsHistoryContract(() => stores().metrics);
  followerHistoryContract(() => stores().followers);
  activityLogContract(() => {
    const { activity, audit, costs } = stores();
    return { activity, audit, costs };
  });
});

describe("D1 records", () => {
  auditLogContract(() => stores().audit);
  costLedgerContract(() => stores().costs);
  metricsRepositoryContract(() => stores().metrics);
  oauthStateContract(() => stores().states);
  loginThrottleContract(() => stores().throttle);
});

describe("D1 people (GROKCHAT-16)", () => {
  personRepositoryContract(stores);
  accountOwnersContract(stores);
});

describe("WebCrypto bot token issuer", () => {
  tokenIssuerContract(() => new WebCryptoBotTokenIssuer());
});

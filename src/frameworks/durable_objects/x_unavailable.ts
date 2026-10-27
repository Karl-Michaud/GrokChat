import type { XResult } from "../../entities/x/x_failure";
import type { RefreshResult } from "../../entities/x/refresh_outcome";
import type { AccountXPorts } from "./account_services";

/**
 * The X ports until the X drivers (PR 4) are wired into the DO: every call fails before a request
 * leaves, so nothing is sent, billed or rotated, and every part waits as a retryable failure
 * (plan §3.1.1).
 */
const notSent = <T>(): Promise<XResult<T>> =>
  Promise.resolve({ ok: false, failure: { kind: "not_sent" } });

export const X_UNAVAILABLE: AccountXPorts = {
  publisher: { create: notSent, delete: notSent },
  uploader: { upload: notSent },
  timeline: { recent: notSent },
  metrics: { read: notSent },
  refresher: { refresh: (): Promise<RefreshResult> => Promise.resolve({ kind: "not_sent" }) },
};

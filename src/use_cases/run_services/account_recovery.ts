import type { AccountId } from "../../entities/identity/ids";
import { transition } from "../../entities/posts/transition";
import type { Instant } from "../../entities/time/instant";
import type { PostReader } from "../ports/post_reader";
import type { PostWriter } from "../ports/post_writer";

/**
 * Run first by every publish call, under `publishLock`: no other publish step for the account is
 * running, so every PUBLISHING post found is dead by construction (A3) and is recovered per §3.1.1
 * (a SENDING part becomes UNKNOWN, never re-sent).
 */
export class AccountRecovery {
  constructor(
    private readonly reader: PostReader,
    private readonly writer: PostWriter,
  ) {}

  async recover(account: AccountId, now: Instant): Promise<number> {
    const stuck = await this.reader.list({ accountIds: [account], lifecycles: ["PUBLISHING"] });
    let recovered = 0;
    for (const post of stuck) {
      const result = transition(post, { kind: "recover", now });
      if (result.ok) {
        const saved = await this.writer.save(result.post, post.version, post.lifecycle);
        recovered += saved.kind === "ok" ? 1 : 0;
      }
    }
    return recovered;
  }
}

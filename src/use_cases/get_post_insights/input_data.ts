import type { Actor } from "../../entities/identity/actor";
import type { PostId } from "../../entities/identity/ids";

export interface GetPostInsightsInputData {
  readonly actor: Actor;
  readonly postId: PostId;
}

import { anyPartIn, type Lifecycle, type Post } from "./post";

export type DoneStatus =
  | "PUBLISHED"
  | "PARTIALLY_PUBLISHED"
  | "UNKNOWN_OUTCOME"
  | "NOT_FOUND"
  | "FAILED"
  | "DELETED"
  | "DELETE_INCOMPLETE";

/** What the dashboard and the MCP tools report: the lifecycle, refined from the parts when DONE. */
export type DerivedStatus = Exclude<Lifecycle, "DONE"> | DoneStatus;

export function derivedStatus(post: Post): DerivedStatus {
  if (post.lifecycle !== "DONE") {
    return post.lifecycle;
  }
  return doneStatus(post);
}

function doneStatus(post: Post): DoneStatus {
  if (anyPartIn(post, "UNKNOWN")) {
    return "UNKNOWN_OUTCOME";
  }
  if (anyPartIn(post, "NOT_FOUND")) {
    return "NOT_FOUND";
  }
  const sent = anyPartIn(post, "SENT");
  if (anyPartIn(post, "DELETED")) {
    return sent ? "DELETE_INCOMPLETE" : "DELETED";
  }
  if (post.parts.every((part) => part.state.kind === "SENT")) {
    return "PUBLISHED";
  }
  return sent ? "PARTIALLY_PUBLISHED" : "FAILED";
}

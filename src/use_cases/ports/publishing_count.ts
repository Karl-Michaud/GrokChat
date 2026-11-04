/** How many posts are PUBLISHING right now: `/health` reports it so a deploy waits (plan §3.6, m7). */
export interface PublishingCount {
  publishingCount(): Promise<number>;
}

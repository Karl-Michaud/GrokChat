import type { PostWriter } from "../use_cases/good";
import type { Post } from "../entities/post";
export class D1PostWriter implements PostWriter {
  constructor(private readonly db: D1Database) {}
  async save(p: Post, v: number): Promise<"ok" | "conflict"> {
    const r = await this.db.prepare("UPDATE posts SET version = ?1 WHERE id = ?2 AND version = ?3").bind(p.version, p.id, v).run();
    return r.meta.changes === 1 ? "ok" : "conflict";
  }
}

import { bump, type Post } from "../entities/post";
export interface PostWriter { save(p: Post, expectedVersion: number): Promise<"ok" | "conflict"> }
export async function touch(w: PostWriter, p: Post): Promise<"ok" | "conflict"> { return w.save(bump(p), p.version); }

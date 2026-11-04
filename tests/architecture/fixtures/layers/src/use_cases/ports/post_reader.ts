import type { PostId } from "../../entities/post";
import { execute } from "../interactor";

export interface PostReader {
  get(id: PostId): unknown;
}
export const bad = execute;

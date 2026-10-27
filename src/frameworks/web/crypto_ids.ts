import type { IdGenerator } from "../../use_cases/ports/id_generator";
import { randomToken } from "./base64url";

/** 128 random bits per id: unguessable, so an OAuth state or a post id cannot be guessed. */
export class RandomIds implements IdGenerator {
  newId(): string {
    return randomToken(16);
  }
}

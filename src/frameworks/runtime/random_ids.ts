import type { IdGenerator } from "../../use_cases/ports/id_generator";

/** Random v4 UUIDs from WebCrypto. */
export class RandomIds implements IdGenerator {
  newId(): string {
    return crypto.randomUUID();
  }
}

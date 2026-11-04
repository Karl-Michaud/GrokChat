/** Unguessable ids for posts, media and OAuth state. */
export interface IdGenerator {
  newId(): string;
}

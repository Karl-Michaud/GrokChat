import type { SavePersonalityInputData } from "./input_data";

/** What a controller calls. */
export interface SavePersonalityInputBoundary {
  execute(input: SavePersonalityInputData): Promise<void>;
}

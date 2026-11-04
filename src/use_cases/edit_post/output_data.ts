import type { CommandResult } from "../authoring/post_command";
import type { PartsRefusalCode } from "../authoring/parts_validator";

export type EditPostOutputData = CommandResult<PartsRefusalCode | "account_not_found">;

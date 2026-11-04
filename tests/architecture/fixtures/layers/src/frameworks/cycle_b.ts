import { a } from "./cycle_a";

export const b = (): number => a() - 1;

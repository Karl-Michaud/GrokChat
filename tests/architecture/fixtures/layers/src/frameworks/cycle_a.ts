import { b } from "./cycle_b";

export const a = (): number => b() + 1;

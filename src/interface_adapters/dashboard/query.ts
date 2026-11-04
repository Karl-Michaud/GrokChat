import { filled } from "./form_values";

/** A query value from a fixed list: the fallback when absent, null when it is not on the list. */
export function oneOf<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): T | null {
  const text = filled(value);
  if (text === null) {
    return fallback;
  }
  return allowed.find((candidate) => candidate === text) ?? null;
}

/** A whole page number from 1; 1 when absent; null when it is not one. */
export function pageNumber(value: string | null): number | null {
  const text = filled(value) ?? "1";
  const page = Number(text);
  return Number.isSafeInteger(page) && page >= 1 && String(page) === text ? page : null;
}

/** An optional filter from a fixed list: null when absent, "invalid" when not on the list. */
export function optional<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | null | "invalid" {
  const text = filled(value);
  if (text === null) {
    return null;
  }
  return allowed.find((candidate) => candidate === text) ?? "invalid";
}

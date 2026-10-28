import type { ExpectedToken } from "../../use_cases/issue_person_token/input_data";

/**
 * The token form's `issued` field (GROKCHAT-18): the token it was shown with, "none" or its
 * creation time in milliseconds. A reload re-sends it; once the token changed it no longer matches,
 * so the reload asks instead of rotating again.
 */
export const NO_TOKEN = "none";

export function issuedField(createdAt: number | null): string {
  return createdAt === null ? NO_TOKEN : String(createdAt);
}

/** The field back as the use case's expectation; null (never issues) when it is not one. */
export function parseIssued(value: string): ExpectedToken | null {
  if (value === NO_TOKEN) {
    return { createdAt: null };
  }
  return /^\d{1,15}$/.test(value) ? { createdAt: Number(value) } : null;
}

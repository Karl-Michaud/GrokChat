/** A label is what the owner calls an upload on the dashboard ("launch banner", GROKCHAT-18). */
export const MAX_LABEL_LENGTH = 80;

export type LabelCheck =
  { readonly ok: true; readonly label: string | null } | { readonly ok: false };

/**
 * The label as typed, trimmed and with runs of whitespace (newlines and tabs included) made one
 * space; empty is no label; longer than 80 characters is refused.
 */
export function parseMediaLabel(raw: string): LabelCheck {
  const label = raw.replace(/\s+/g, " ").trim();
  if (label.length > MAX_LABEL_LENGTH) {
    return { ok: false };
  }
  return { ok: true, label: label === "" ? null : label };
}

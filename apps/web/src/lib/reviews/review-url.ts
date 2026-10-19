// Shared http(s) check for the per-company Google review link.
// Used by the reviews sender, the portal-settings API, and the admin UI.
// No Node built-ins, so the settings page can import it from the client.

export type ParsedReviewUrl =
  | { ok: true; url: string }
  | { ok: false; reason: "empty" | "invalid" };

/** Trim and accept only absolute http(s) URLs. Empty input is a clear, not an error. */
export function parseReviewUrl(value: string | null | undefined): ParsedReviewUrl {
  if (value == null) return { ok: false, reason: "empty" };
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, reason: "empty" };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "invalid" };
  }
  if (!url.hostname) return { ok: false, reason: "invalid" };
  return { ok: true, url: trimmed };
}

/** German validation message for the admin API and settings form. Null means accept. */
export function googleReviewUrlFieldError(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    return "Google-Bewertungs-URL muss ein Text sein.";
  }
  const parsed = parseReviewUrl(value);
  if (!parsed.ok && parsed.reason === "invalid") {
    return "Ungültige Google-Bewertungs-URL. Bitte eine http(s)-Adresse eintragen.";
  }
  return null;
}

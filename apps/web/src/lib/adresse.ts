/**
 * Parse a freeform German address ("Straße Nr, PLZ Ort") into the canonical
 * location shape { line1, postcode, city }. Falls back to line1-only when the
 * format is not recognized, so downstream consumers (depot PLZ-auto-pick, CSV
 * export) get structured city/postcode when available.
 */
export function addressStringToLocationValue(text: string): Record<string, unknown> {
  const raw = text.trim();
  const result: Record<string, unknown> = { line1: raw };
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    result.line1 = parts[0];
    for (let i = 1; i < parts.length; i++) {
      const m = parts[i].match(/\b(\d{5})\b\s*(.*)/);
      if (m) {
        result.postcode = m[1];
        // Ort hinter der PLZ, sonst im nächsten Teil („75365, Calw“).
        const ort = m[2]?.trim() || parts[i + 1];
        if (ort) result.city = ort;
        break;
      }
    }
    if (!result.postcode && !result.city) result.city = parts[1];
  }
  return result;
}

/** Adresse als Text für Eingabefelder: „Straße Nr, PLZ Ort“ (umkehrbar). */
export function locationValueToText(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v !== "object") return "";
  const o = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" ? x.trim() : "");
  const ort = [str(o.postcode), str(o.city)].filter(Boolean).join(" ");
  return [str(o.line1), ort].filter(Boolean).join(", ");
}

/** Ort in der Form der Adress-Autovervollständigung. */
export interface OrtWert {
  line1?: string;
  postcode?: string;
  city?: string;
  countryCode?: string;
}

/**
 * Gespeicherte Adresse (jsonb oder Text) als Wert für das Formular. Text wird
 * zerlegt statt verworfen; ohne Straße gilt die Adresse als fehlend.
 */
export function alsOrtWert(v: unknown): OrtWert | null {
  if (!v) return null;
  const o = (typeof v === "string" ? addressStringToLocationValue(v) : v) as Record<string, unknown>;
  if (typeof o !== "object") return null;
  const s = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
  const ort: OrtWert = { line1: s(o.line1), postcode: s(o.postcode), city: s(o.city), countryCode: s(o.countryCode) };
  return ort.line1 ? ort : null;
}

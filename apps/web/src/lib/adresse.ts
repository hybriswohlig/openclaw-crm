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

/** Vergleichsschlüssel einer Adresse mit Straße (Text oder jsonb); null ohne Straße. */
function adressSchluessel(v: unknown): { basis: string; zusatz: string } | null {
  if (!v) return null;
  const o = (typeof v === "string" ? addressStringToLocationValue(v) : v) as Record<string, unknown>;
  if (!o || typeof o !== "object") return null;
  const teil = (x: unknown) =>
    typeof x === "string"
      ? x
          .toLocaleLowerCase("de-DE")
          .replace(/stra(ß|ss)e\b/g, "str")
          .replace(/[^\p{L}\p{N}]/gu, "")
      : "";
  const strasse = teil(o.line1);
  if (!strasse || /^\d{5}/.test(strasse)) return null;
  return { basis: [strasse, teil(o.postcode), teil(o.city)].join("|"), zusatz: teil(o.line2) };
}

/**
 * true, wenn Auszug und Einzug dieselbe Adresse mit Straße sind (KV-Meldung 10.11.:
 * VON und NACH zeigten beide die Auszugsadresse). Schreibweisen wie „Str.“/„Straße“,
 * Leerzeichen und Kommas zählen nicht; zwei verschiedene Zusätze (Etage, Wohnung) schon.
 * Ohne Straße (nur PLZ und Ort, Umzug im selben Ort) nie gleich.
 */
export function gleicheAdresse(a: unknown, b: unknown): boolean {
  const x = adressSchluessel(a);
  const y = adressSchluessel(b);
  if (!x || !y || x.basis !== y.basis) return false;
  return !(x.zusatz && y.zusatz && x.zusatz !== y.zusatz);
}

/**
 * „Einzug noch offen“ (Inhaber 10.11.): ohne Migration als Markierung im Ortswert
 * `move_to_address` gespeichert, `{ line1: "wird noch abgestimmt", offen: true }`.
 * So druckt jeder Leser, der nur `line1` kennt (KV/AB über `strecke_nach`, Portal,
 * Mitarbeiterportal), von selbst „wird noch abgestimmt“; der Rechner und die
 * KI-Übernahme behandeln den Einzug weiter als fehlend.
 */
export const EINZUG_OFFEN_TEXT = "wird noch abgestimmt";
export const EINZUG_OFFEN_WERT = { line1: EINZUG_OFFEN_TEXT, offen: true } as const;

/** true, wenn der Ortswert die Markierung „Einzug noch offen“ trägt (auch als reiner Text). */
export function einzugOffen(v: unknown): boolean {
  if (typeof v === "string") return v.trim().toLowerCase() === EINZUG_OFFEN_TEXT;
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return o.offen === true || (typeof o.line1 === "string" && o.line1.trim().toLowerCase() === EINZUG_OFFEN_TEXT && !o.postcode && !o.city);
}

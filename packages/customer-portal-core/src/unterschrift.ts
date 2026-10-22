/**
 * Unterschrift im Kundenportal nach der Annahme. Die Annahme bleibt der
 * verbindliche Akt; die Unterschrift ist freiwillig und macht aus dem
 * angenommenen KV eine unterschriebene Vertragsmappe.
 */

export type UnterschriftArt = "gezeichnet" | "getippt";

export interface UnterschriftPayload {
  art: UnterschriftArt;
  name: string;
  /** PNG als Data-URL bei „gezeichnet“, sonst null. */
  bildDataUrl: string | null;
}

export interface UnterschriftRecord {
  /** ISO-Zeitpunkt der Unterschrift. */
  at: string;
  name: string;
  art: UnterschriftArt;
}

const PNG_PRAEFIX = "data:image/png;base64,";
/** Zeichen hinter dem Präfix, etwa 300 KB PNG. */
export const UNTERSCHRIFT_BILD_MAX_BASE64 = 400_000;

export function parseUnterschriftPayload(raw: unknown): UnterschriftPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.art !== "gezeichnet" && r.art !== "getippt") return null;
  if (typeof r.name !== "string") return null;
  const name = r.name.trim();
  if (name.length < 2 || name.length > 200) return null;
  if (r.art === "getippt") return { art: "getippt", name, bildDataUrl: null };
  const bild = r.bildDataUrl;
  if (typeof bild !== "string" || !bild.startsWith(PNG_PRAEFIX)) return null;
  const laenge = bild.length - PNG_PRAEFIX.length;
  if (laenge <= 0 || laenge > UNTERSCHRIFT_BILD_MAX_BASE64) return null;
  return { art: "gezeichnet", name, bildDataUrl: bild };
}

/** Unterschrift anbieten: aktive Annahme mit gebundenem KV-PDF, Firma hat sie eingeschaltet, noch nicht unterschrieben. */
export function unterschriftMoeglich(input: {
  acceptance: { quotationDocumentId: string | null; unterschrift: UnterschriftRecord | null } | null;
  signatureEnabled: boolean;
}): boolean {
  const a = input.acceptance;
  return input.signatureEnabled && !!a && !!a.quotationDocumentId && !a.unterschrift;
}

/** Nach der Annahme hat eine offene Anzahlung Vorrang vor der freiwilligen Unterschrift. */
export function naechsteAktionNachAnnahme(input: {
  anzahlungOffen: boolean;
  unterschriftMoeglich: boolean;
}): "anzahlung" | "unterschrift" | "keine" {
  if (input.anzahlungOffen) return "anzahlung";
  if (input.unterschriftMoeglich) return "unterschrift";
  return "keine";
}

/**
 * Reine Hilfsfunktionen, um CRM-Werte (EAV-Record-Werte, Inventarzeilen) in
 * die Form zu bringen, die der Angebotsrechner erwartet. Ohne Datenbank.
 */
import type { LeadDaten } from "./eingabe";

/**
 * Adresse als Text für den Rechner: "Straße, PLZ Ort", ohne Straße nur "PLZ Ort".
 * Kein Komma zwischen PLZ und Ort: der Rechner erkennt reine Ortsangaben daran,
 * dass sie kein Komma enthalten ("innerhalb desselben Ortes").
 */
export function ortText(wert: unknown): string | null {
  if (typeof wert === "string") return wert.trim() === "" ? null : wert.trim();
  if (!wert || typeof wert !== "object") return null;
  const o = wert as Record<string, unknown>;
  const teil = (k: string) => (typeof o[k] === "string" && (o[k] as string).trim() !== "" ? (o[k] as string).trim() : null);
  const ort = [teil("postcode"), teil("city")].filter(Boolean).join(" ");
  const text = [teil("line1"), ort || null].filter(Boolean).join(", ");
  return text === "" ? null : text;
}

export function zahlOderNull(wert: unknown): number | null {
  if (typeof wert === "number") return Number.isFinite(wert) ? wert : null;
  if (typeof wert === "string" && wert.trim() !== "") {
    const n = Number(wert);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Datum als YYYY-MM-DD aus einem Datums- oder ISO-Zeitstempel-Text, sonst null. */
export function datumText(wert: unknown): string | null {
  if (typeof wert !== "string") return null;
  const treffer = /^(\d{4}-\d{2}-\d{2})/.exec(wert.trim());
  return treffer ? treffer[1]! : null;
}

export interface InventarRohzeile {
  name: string;
  quantity: number;
  sizeClass: string | null;
  /** Volumen der ganzen Zeile (Menge eingerechnet), so schätzt es die CRM-KI */
  volumeCbmEstimate: string | null;
  moveFlag: boolean;
}

/** Inventarzeilen des CRM → Rechner-Inventar; Volumen je Stück. */
export function inventarAusZeilen(zeilen: readonly InventarRohzeile[]): LeadDaten["inventar"] {
  return zeilen.map((z) => {
    const menge = z.quantity > 0 ? z.quantity : 1;
    const gesamt = zahlOderNull(z.volumeCbmEstimate);
    return {
      name: z.name,
      menge,
      groessenklasse: z.sizeClass,
      volumenCbm: gesamt !== null && gesamt > 0 ? Math.round((gesamt / menge) * 1000) / 1000 : null,
      mitnehmen: z.moveFlag,
    };
  });
}

/** Positive Zahl aus Zahl oder Text ("57", "57,5", "57 m²"), sonst null. */
function positiveZahl(wert: unknown): number | null {
  if (typeof wert === "number") return Number.isFinite(wert) && wert > 0 ? wert : null;
  if (typeof wert !== "string") return null;
  const treffer = /-?\d+(?:[.,]\d+)?/.exec(wert);
  if (!treffer) return null;
  const n = Number(treffer[0].replace(",", "."));
  return n > 0 ? n : null;
}

/**
 * Zimmerzahl aus Portal-Angaben: "1-2" und "2 - 3" ergeben die obere Zahl,
 * "5+" ergibt 5, "2,5" bleibt 2,5. Unbrauchbares wird null.
 */
export function zimmerZahl(wert: unknown): number | null {
  if (typeof wert !== "string") return positiveZahl(wert);
  if (/^\s*-/.test(wert)) return null;
  const zahlen = wert.match(/\d+(?:[.,]\d+)?/g);
  if (!zahlen) return null;
  return positiveZahl(zahlen[zahlen.length - 1]);
}

/**
 * Wohnfläche und Zimmer eines Leads. Reihenfolge: Felder am Deal, dann der
 * Portal-Import (moving_lead_payload.from), dann die Inventar-Notizen des
 * Imports ("Wohnfläche: 57 m²", "Zimmer: 1-2"). Nie eine Exception.
 */
export function groesseAusLead(werte: Record<string, unknown>): { wohnflaecheQm: number | null; zimmer: number | null } {
  const payload = werte.moving_lead_payload;
  const von =
    payload && typeof payload === "object" && (payload as Record<string, unknown>).from && typeof (payload as Record<string, unknown>).from === "object"
      ? ((payload as Record<string, unknown>).from as Record<string, unknown>)
      : {};
  const notizen = typeof werte.inventory_notes === "string" ? werte.inventory_notes : "";
  const ausNotiz = (feld: string) => new RegExp(`^\\s*${feld}:\\s*(.+)$`, "m").exec(notizen)?.[1] ?? null;

  return {
    wohnflaecheQm: positiveZahl(werte.wohnflaeche_qm) ?? positiveZahl(von.livingSpace) ?? positiveZahl(ausNotiz("Wohnfläche")),
    zimmer: zimmerZahl(werte.zimmer) ?? zimmerZahl(von.rooms) ?? zimmerZahl(ausNotiz("Zimmer")),
  };
}

/** ID aus einem Referenzwert: String oder { id } bzw. { referencedRecordId }. */
export function referenzId(wert: unknown): string | null {
  if (typeof wert === "string" && wert !== "") return wert;
  if (wert && typeof wert === "object") {
    const o = wert as { id?: unknown; referencedRecordId?: unknown };
    if (typeof o.id === "string") return o.id;
    if (typeof o.referencedRecordId === "string") return o.referencedRecordId;
  }
  return null;
}

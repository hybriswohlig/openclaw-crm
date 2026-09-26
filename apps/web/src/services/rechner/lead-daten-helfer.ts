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

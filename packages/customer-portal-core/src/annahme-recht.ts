/**
 * Rechtsregeln der KV-Annahme. Dialog (Client) und confirmKvaForToken (Server)
 * rufen dieselben Funktionen auf, damit beide nie auseinanderlaufen.
 */
import { daysUntilMove } from "./stage-derivation";
import type { ConfirmKvaPayload } from "./types";

/** clearance = Entrümpelung, Haushaltsauflösung (Werkvertrag, nicht Beförderung). */
export type ServiceArt = "move" | "kitchen_installation" | "clearance";

/**
 * Bis zu so vielen Tagen zwischen Vertragsschluss und Termin liegt der Beginn
 * in der Widerrufsfrist. Die Frist endet mit Ablauf des 14. Tages (§§ 187,
 * 188 BGB); fällt das Ende auf Wochenende oder Feiertag, verschiebt es sich
 * (§ 193 BGB). 17 deckt Wochenende plus Feiertag ab; zu oft fragen schadet nicht.
 */
export const VORZEITIGER_BEGINN_TAGE = 17;
export type WiderrufModus = "ausgeschlossen" | "belehrung";

/**
 * Umzug mit festem Termin: § 312g Abs. 2 S. 1 Nr. 9 BGB. Sonst Belehrung,
 * auch bei Entrümpelung: Hauptleistung ist Räumen und Entsorgen, die
 * Ausnahme für Beförderung wird eng ausgelegt.
 */
export function widerrufModus(serviceType: ServiceArt): WiderrufModus {
  return serviceType === "move" ? "ausgeschlossen" : "belehrung";
}

export interface AnnahmeRegeln {
  serviceType: ServiceArt;
  widerrufModus: WiderrufModus;
  /** § 451g HGB gilt nur für den Umzugsvertrag. */
  haftungshinweisErforderlich: boolean;
  /** Belehrung und Leistungsbeginn vor Ende der 14-Tage-Frist. */
  vorzeitigerBeginnErforderlich: boolean;
  /** Umzug ohne festen Termin oder mit offener Terminwahl: keine Annahme. */
  terminFehlt: boolean;
}

export function annahmeRegeln(input: {
  serviceType: ServiceArt;
  moveDate: string | null;
  hasOpenDateChoice: boolean;
  now: Date;
}): AnnahmeRegeln {
  const modus = widerrufModus(input.serviceType);
  return {
    serviceType: input.serviceType,
    widerrufModus: modus,
    haftungshinweisErforderlich: input.serviceType === "move",
    vorzeitigerBeginnErforderlich: modus === "belehrung" && beginntInWiderrufsfrist(input.moveDate, input.now),
    terminFehlt:
      input.hasOpenDateChoice || (input.serviceType === "move" && !input.moveDate),
  };
}

function beginntInWiderrufsfrist(moveDate: string | null, now: Date): boolean {
  const tage = daysUntilMove(moveDate, now);
  return tage != null && tage >= 0 && tage <= VORZEITIGER_BEGINN_TAGE;
}

/**
 * Body der Annahme-Route prüfen. Nur echtes `true` zählt als Häkchen; ein
 * fehlender Preis (alter Browser-Stand) wird NaN und führt zu price_changed.
 */
export function parseConfirmKvaPayload(raw: unknown): ConfirmKvaPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  const name = typeof b.fullName === "string" ? b.fullName.trim().slice(0, 200) : "";
  return {
    acceptedOffer: b.acceptedOffer === true,
    acceptedAgb: b.acceptedAgb === true,
    haftungshinweisBestaetigt: b.haftungshinweisBestaetigt === true,
    versicherungGewuenscht: b.versicherungGewuenscht === true,
    vorzeitigerBeginnVerlangt: b.vorzeitigerBeginnVerlangt === true,
    expectedTotalCents:
      typeof b.expectedTotalCents === "number" && Number.isFinite(b.expectedTotalCents)
        ? b.expectedTotalCents
        : Number.NaN,
    fullName: name || null,
  };
}

/** Preis, den der Kunde im Dialog sieht: gewählte Option, sonst Angebotssumme. */
export function erwarteterGesamtpreis(input: {
  dealOptions: Array<{ id: string; priceCents: number }>;
  selectedOptionId: string | null | undefined;
  totalCents: number;
}): number {
  const option = input.dealOptions.find((o) => o.id === input.selectedOptionId);
  return option && option.priceCents > 0 ? option.priceCents : input.totalCents;
}

export type AnnahmeSperrgrund =
  | "missing_acknowledgement"
  | "date_required"
  | "price_changed"
  | "haftungshinweis_required"
  | "vorzeitiger_beginn_required";

export function annahmeSperrgrund(input: {
  payload: ConfirmKvaPayload;
  regeln: AnnahmeRegeln;
  agbVorhanden: boolean;
  aktuellerPreisCents: number;
}): AnnahmeSperrgrund | null {
  const { payload, regeln } = input;
  if (!payload.acceptedOffer) return "missing_acknowledgement";
  if (input.agbVorhanden && !payload.acceptedAgb) return "missing_acknowledgement";
  if (regeln.terminFehlt) return "date_required";
  if (payload.expectedTotalCents !== input.aktuellerPreisCents) return "price_changed";
  if (regeln.haftungshinweisErforderlich && !payload.haftungshinweisBestaetigt) {
    return "haftungshinweis_required";
  }
  if (regeln.vorzeitigerBeginnErforderlich && !payload.vorzeitigerBeginnVerlangt) {
    return "vorzeitiger_beginn_required";
  }
  return null;
}

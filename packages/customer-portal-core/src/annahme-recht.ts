/**
 * Rechtsregeln der KV-Annahme. Dialog (Client) und confirmKvaForToken (Server)
 * rufen dieselben Funktionen auf, damit beide nie auseinanderlaufen.
 */
import { widerrufVerzichtRequired } from "./stage-derivation";
import type { ConfirmKvaPayload } from "./types";

export type ServiceArt = "move" | "kitchen_installation";
export type WiderrufModus = "ausgeschlossen" | "belehrung";

/** Umzug mit festem Termin: § 312g Abs. 2 S. 1 Nr. 9 BGB. Sonst Belehrung. */
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
    vorzeitigerBeginnErforderlich:
      modus === "belehrung" && widerrufVerzichtRequired(input.moveDate, input.now),
    terminFehlt:
      input.hasOpenDateChoice || (input.serviceType === "move" && !input.moveDate),
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

/**
 * Rechtsregeln der KV-Annahme. Dialog (Client) und confirmKvaForToken (Server)
 * rufen dieselben Funktionen auf, damit beide nie auseinanderlaufen.
 */
import { kundenText } from "./anrede";
import { preisAmTag, tagHatPreis, wahlPaketSlug } from "./offer-selection";
import { daysUntilMove } from "./stage-derivation";
import type { ConfirmKvaPayload } from "./types";
import { widerrufsfristEnde } from "./widerruf";

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
  /**
   * Umzug oder Entrümpelung ohne festen Termin oder mit offener Terminwahl:
   * keine Annahme. Bei der Entrümpelung fehlte sonst das Verlangen nach
   * vorzeitigem Beginn, wenn der Termin später in die Frist fällt.
   */
  terminFehlt: boolean;
  /**
   * Termin liegt vor heute (Berlin): keine Annahme mehr. Sonst begänne bei
   * Küche und Entrümpelung eine neue 14-Tage-Widerrufsfrist für erledigte
   * Arbeit, ohne Verlangen nach vorzeitigem Beginn.
   */
  terminVorbei: boolean;
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
      input.hasOpenDateChoice || ((input.serviceType === "move" || input.serviceType === "clearance") && !input.moveDate),
    // Bietet das Büro neue Termine an, zählt der alte nicht mehr.
    terminVorbei: !input.hasOpenDateChoice && (daysUntilMove(input.moveDate, input.now) ?? 0) < 0,
  };
}

/** Pauschal 17 Tage oder bis zum echten Fristende, je nachdem was länger ist (Ostern). */
function beginntInWiderrufsfrist(moveDate: string | null, now: Date): boolean {
  const tage = daysUntilMove(moveDate, now);
  if (tage == null || tage < 0 || !moveDate) return false;
  return tage <= VORZEITIGER_BEGINN_TAGE || moveDate <= widerrufsfristEnde(now);
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

/**
 * Preis, den der Kunde annimmt. Server (Annahme, Portal-Kontext), Annahme-
 * dialog, Preiskarte und Mobil-Leiste rufen genau diese Funktion auf.
 *
 * Tag vor Paket wie `wahlPreis` im CRM (Plan 5b, Entscheidung 9): trägt das
 * gewählte Terminangebot Preise aus der Version, gilt der Preis des Pakets an
 * diesem Tag, ohne Paket der Tagespreis; hat die Wahl dort keinen Preis, 0
 * (Annahme gesperrt, zero_price). Ohne Tagespreise wie vor 5b: gewählte
 * Option, sonst Angebotssumme.
 */
export function erwarteterGesamtpreis(input: {
  dealOptions: Array<{ id: string; priceCents: number; catalogueSlug?: string | null; isRecommended?: boolean; gebunden?: boolean }>;
  selectedOptionId: string | null | undefined;
  totalCents: number;
  dateOffers?: Array<{ id: string; priceCents: number | null; packagePrices: Record<string, number> | null }>;
  selectedDateOfferId?: string | null;
}): number {
  const option = input.dealOptions.find((o) => o.id === input.selectedOptionId);
  const tag = input.selectedDateOfferId ? input.dateOffers?.find((d) => d.id === input.selectedDateOfferId) : undefined;
  // Mit Tagespreisen das Paket nach derselben Regel wie das CRM (`wahlPaketSlug`, nur gebundene Optionen).
  if (tag && tagHatPreis(tag)) return preisAmTag(tag, wahlPaketSlug(input.dealOptions, input.selectedOptionId)) ?? 0;
  return option && option.priceCents > 0 ? option.priceCents : input.totalCents;
}

export type AnnahmeSperrgrund =
  | "missing_acknowledgement"
  | "date_required"
  | "termin_vorbei"
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
  if (regeln.terminVorbei) return "termin_vorbei";
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

/**
 * Passt das neueste KV-PDF zur Kalkulationsversion der Quotation? Der Server
 * bestimmt den Stand (CRM: `kvStand` in lib/angebot-wahl.ts) und gibt ihn im
 * Kontext mit. „ohne_version“: Quotation ohne Version (Altbestand, von Hand),
 * Regel von heute.
 */
export type KvStand = "passt" | "veraltet" | "ohne_version";

/** Ablehnungscode der Annahme, solange das PDF nicht zur aktuellen Version passt (409). */
export const KV_VERALTET = "kv_veraltet" as const;

/** Dialog und confirmKvaForToken: Annahme gesperrt, solange das KV-PDF veraltet ist. */
export function annahmeKvSperre(stand: KvStand | null | undefined): typeof KV_VERALTET | null {
  return stand === "veraltet" ? KV_VERALTET : null;
}

/** Titel und Hinweis statt des Annahme-Knopfs; auch die Fehlermeldung des Dialogs. */
export function kvVeraltetTitel(firma: string | null | undefined): string {
  return kundenText(firma, "Ihr Angebot wird gerade aktualisiert", "Dein Angebot wird gerade aktualisiert");
}

export function kvVeraltetText(firma: string | null | undefined): string {
  return kundenText(
    firma,
    "Wir erstellen gerade den Kostenvoranschlag zu Ihrem aktuellen Preis. In wenigen Minuten können Sie das Angebot hier annehmen. Die Seite aktualisiert sich von selbst.",
    "Wir erstellen gerade den Kostenvoranschlag zu deinem aktuellen Preis. In wenigen Minuten kannst du das Angebot hier annehmen. Die Seite aktualisiert sich von selbst."
  );
}

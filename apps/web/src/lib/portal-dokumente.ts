/**
 * Reine Regeln, welches Dokument das Kundenportal zeigt und welche
 * Auftragsart ein KV-Auftrag auf dem Angebot hinterlegt.
 */
import type { ServiceArt } from "@openclaw-crm/customer-portal-core";

interface Dok {
  id: string;
  uploadedAt: Date;
}

/**
 * Neuestes KV, unabhängig davon, wann die Angebotszeile zuletzt gespeichert
 * wurde. Ein späteres Speichern von Preis, Zusammenfassung oder Gültigkeit
 * versteckt ein schon hochgeladenes PDF nicht. null, wenn keins da ist —
 * dann zeigt das Portal das HTML-Angebot.
 */
export function neuestesKvDokument<T extends Dok>(docs: readonly T[]): T | null {
  let aktuell: T | null = null;
  for (const doc of docs) {
    if (!aktuell || doc.uploadedAt.getTime() > aktuell.uploadedAt.getTime()) aktuell = doc;
  }
  return aktuell;
}

/**
 * Nach der Annahme das gebundene PDF. Hat die Annahme keins (Altbestand
 * oder kein aktuelles PDF beim Klick), gilt die normale Regel weiter.
 */
export function angezeigtesKvDokument<T extends Dok>(input: {
  quotationDocumentId: string | null;
  angenommen: boolean;
  docRows: T[];
  aktuellesKv: T | null;
}): T | null {
  if (input.angenommen && input.quotationDocumentId) {
    return input.docRows.find((d) => d.id === input.quotationDocumentId) ?? input.aktuellesKv;
  }
  return input.aktuellesKv;
}

/**
 * Eine Auftragsbestätigung aus der Zeit vor einem „Annahme aufheben“ gehört
 * zum alten Stand: Sie zählt weder für die Stufe noch wird sie angezeigt,
 * sonst landet der Kunde in Stufe 2 und kann nicht neu annehmen.
 */
export function gueltigeAuftragsbestaetigung<T extends Dok>(ab: T | null | undefined, aufgehobenAm: Date | null): T | null {
  if (!ab) return null;
  if (aufgehobenAm && ab.uploadedAt <= aufgehobenAm) return null;
  return ab;
}

/** Beim Erzeugen eines KV die gewählte Auftragsart am Angebot speichern. */
export function serviceTypeZuSpeichern(input: {
  documentType: unknown;
  gewaehlt: ServiceArt;
  gespeichert: string | null | undefined;
  angenommen: boolean;
}): ServiceArt | null {
  if (input.documentType !== "KV" || input.angenommen) return null;
  return input.gespeichert === input.gewaehlt ? null : input.gewaehlt;
}

/**
 * Leistungsart für die VPS-Vorlage. Seit 18.11. kennt sie Umzug, Küche und Entrümpelung
 * (eigenes Layout: ein Einsatzort, keine Einzugsadresse, kein § 451g). Entrümpelung + Umzug
 * kommt hier schon als „move“ an.
 */
export function vpsLeistungsart(art: ServiceArt): ServiceArt {
  return art === "kitchen_installation" || art === "clearance" ? art : "move";
}

/**
 * Leistungen, die an die VPS-Vorlage gehen. Gespeicherte Leistungen und Pakete sind
 * Umzugsleistungen (Einpacken, Montage, Halteverbot am Einzugsort …). Bei einer Entrümpelung
 * gehen sie nicht mit; die Vorlage setzt Räumung, Abtransport und Entsorgung selbst.
 */
export function vpsLeistungen<T>(art: ServiceArt, umzugsLeistungen: T | undefined, standard: T): T | undefined {
  if (art === "clearance") return undefined;
  // Küche: wie bisher durchreichen, ohne Umzugs-Standard (die Vorlage liest kitchen.services).
  if (art === "kitchen_installation") return umzugsLeistungen;
  return umzugsLeistungen ?? standard;
}

/**
 * Dokumenttypen, die der Kundenlink ausliefern darf. Interne Dokumente
 * (Auftragsanweisung, Zahlungsbestätigung) bleiben im CRM, auch wenn
 * jemand ihre ID kennt.
 */
export const OEFFENTLICHE_DOKUMENTTYPEN = ["quotation", "order_confirmation", "invoice", "signed_contract"] as const;

export function oeffentlichAbrufbar(documentType: string): boolean {
  return (OEFFENTLICHE_DOKUMENTTYPEN as readonly string[]).includes(documentType);
}

/** Im CRM löschbar? Die unterschriebene Vertragsmappe ist an die Annahme gebunden und bleibt. */
export function loeschbar(documentType: string): boolean {
  return documentType !== "signed_contract";
}

/** Link auf die unterschriebene Vertragsmappe, nur bei aktiver Annahme mit Dokument. */
export function vertragUrl(input: { token: string; angenommen: boolean; vertragDocumentId: string | null }): string | null {
  if (!input.angenommen || !input.vertragDocumentId) return null;
  return `/api/public/${input.token}/documents/${input.vertragDocumentId}`;
}

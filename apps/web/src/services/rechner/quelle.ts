/**
 * Marke und Lead-Quelle für den Margenvorschlag des Angebotsrechners
 * (Spec 2026-09-28 im Rechner-Repo). Reine Funktionen.
 * Website-Formulare haben im CRM keine Kennzeichnung und laufen als "direkt".
 */
import { isImmoscoutEmail } from "@/services/inbox-immoscout";
import { isKleinanzeigenRelayAddress } from "@/services/inbox-kleinanzeigen";

export type LeadQuelle = "vergleichsportal" | "kleinanzeigen" | "website" | "direkt" | "unbekannt";
export type Marke = "kottke" | "ceylan";

const KLEINANZEIGEN_BETREFF = /kleinanzeigen|nutzer-anfrage|anfrage zu deiner anzeige|zu ihrer anzeige/i;

export function markeAusFirmenname(name: string | null): Marke | null {
  const n = (name ?? "").toLowerCase();
  if (n.includes("kottke")) return "kottke";
  if (n.includes("ceylan") || n.includes("rümpeltürken") || n.includes("ruempeltuerken")) return "ceylan";
  return null;
}

export function leadQuelle(e: { payloadSource: string | null; konversationen: Array<{ kontaktEmail: string | null; betreff: string | null }> }): LeadQuelle {
  if (e.payloadSource === "immoscout24" || e.konversationen.some((k) => isImmoscoutEmail(k.kontaktEmail))) return "vergleichsportal";
  if (e.konversationen.some((k) => isKleinanzeigenRelayAddress(k.kontaktEmail) || KLEINANZEIGEN_BETREFF.test(k.betreff ?? ""))) return "kleinanzeigen";
  return e.konversationen.length > 0 ? "direkt" : "unbekannt";
}

export function heuteBerlin(jetzt: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(jetzt);
}

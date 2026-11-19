/**
 * Leistung in der Akte („Kunde und Adressen“, „Es fehlen noch Angaben“): Auswahl
 * und welche Felder mit welchem Namen dazugehören. Rein, ohne Datenbank.
 *
 * Entrümpelung und Küchenmontage haben kein Ziel: kein Einzug. Die Kundenanschrift
 * ist dort der Einsatzort bzw. der Einbauort (die Küchen-KV nimmt die Auszugsadresse
 * als Einbauort, Review 19.11.).
 */
import type { PortalLeistung } from "@openclaw-crm/customer-portal-core";
import { ALLE_FELDER, type KundeFeld } from "./kunde-entwurf";

export const AKTE_LEISTUNGEN: ReadonlyArray<{ wert: PortalLeistung; label: string }> = [
  { wert: "move", label: "Umzug" },
  { wert: "clearance_move", label: "Entrümpelung + Umzug" },
  { wert: "clearance", label: "Entrümpelung" },
  { wert: "kitchen_installation", label: "Küchenmontage" },
];

export function leistungLabel(l: PortalLeistung | null | undefined): string {
  return AKTE_LEISTUNGEN.find((x) => x.wert === l)?.label ?? "Umzug";
}

export interface KundeAnsicht {
  /** Felder in dieser Reihenfolge; ohne Ziel fehlt der Einzug. */
  felder: KundeFeld[];
  labels: Partial<Record<KundeFeld, string>>;
}

export function kundeAnsicht(l: PortalLeistung | null | undefined): KundeAnsicht {
  if (l === "clearance") {
    return {
      felder: ALLE_FELDER.filter((f) => f !== "einzug"),
      labels: { auszug: "Einsatzort (Kundenanschrift)", datum: "Termin" },
    };
  }
  if (l === "kitchen_installation") {
    return {
      felder: ALLE_FELDER.filter((f) => f !== "einzug"),
      labels: { auszug: "Einbauort (Kundenanschrift)", datum: "Montagetermin" },
    };
  }
  return { felder: [...ALLE_FELDER], labels: {} };
}

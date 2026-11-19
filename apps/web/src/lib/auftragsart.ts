/**
 * Auftragsart für den Angebotsrechner. Dieselbe Vorbelegung wie der KV-Dialog
 * (leistungsartVorschlag): gespeicherte Küche oder Entrümpelung zuerst, sonst
 * eine Entrümpelungs-Anfrage, sonst Umzug. „move“ ist der Spalten-Default.
 * Transport bleibt im Typ, kommt aus dieser Ableitung aber nicht.
 */
import { istPortalLeistung, leistungsartVorschlag } from "./kv-vorpruefung";

export type Auftragsart = "umzug" | "entruempelung" | "transport" | "kuechenmontage";

export function auftragsartAus(input: Parameters<typeof leistungsartVorschlag>[0]): Auftragsart {
  // Lead-Typ „Küche“/„Kuechenmontage“ aus Portalen und Formularen (ohne gespeichertes Angebot).
  // Eine Wahl in der Akte geht vor (Review Grok 19.11.: sonst bliebe ein Küchen-Lead in der Kalkulation Küche).
  if (!input.gespeichert && !istPortalLeistung(input.akte) && /k(?:ü|ue)che/i.test(input.leadType ?? "")) return "kuechenmontage";
  const art = leistungsartVorschlag(input);
  if (art === "clearance") return "entruempelung";
  if (art === "kitchen_installation") return "kuechenmontage";
  // Entrümpelung + Umzug rechnet der Angebotsrechner als Umzug.
  return "umzug";
}

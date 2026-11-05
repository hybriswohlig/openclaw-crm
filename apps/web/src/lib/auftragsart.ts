/**
 * Auftragsart für den Angebotsrechner. Dieselbe Vorbelegung wie der KV-Dialog
 * (leistungsartVorschlag): gespeicherte Küche oder Entrümpelung zuerst, sonst
 * eine Entrümpelungs-Anfrage, sonst Umzug. „move“ ist der Spalten-Default.
 * Transport bleibt im Typ, kommt aus dieser Ableitung aber nicht.
 */
import { leistungsartVorschlag } from "./kv-vorpruefung";

export type Auftragsart = "umzug" | "entruempelung" | "transport" | "kuechenmontage";

export function auftragsartAus(input: { gespeichert: string | null; leadType: string | null }): Auftragsart {
  const art = leistungsartVorschlag(input);
  if (art === "clearance") return "entruempelung";
  if (art === "kitchen_installation") return "kuechenmontage";
  return "umzug";
}

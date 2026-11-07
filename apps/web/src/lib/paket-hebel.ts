/**
 * Hebel je Paket (`offer_packages.hebel`, Plan 5b F6): welche Leistungen der
 * Paketpreis über den Kern hinaus enthält. Rein, für Settings-API und
 * Einstellungsdialog.
 */
import type { HebelArt } from "@/services/rechner/kv-posten";

/** Feste Reihenfolge für Anzeige und Speicherung. */
export const PAKET_HEBEL: readonly HebelArt[] = ["halteverbot", "montage", "einpacken", "kueche"];

export const PAKET_HEBEL_LABEL: Record<HebelArt, string> = {
  halteverbot: "Halteverbot",
  montage: "Montage",
  einpacken: "Einpacken",
  kueche: "Küche",
};

/**
 * `hebel` aus einem Request-Körper: fehlt → undefined (nicht ändern),
 * gültig → bereinigte Liste ohne Doppel in fester Reihenfolge, sonst null
 * (400). Nur die vier bekannten Hebel.
 */
export function hebelAusEingabe(roh: unknown): HebelArt[] | null | undefined {
  if (roh === undefined) return undefined;
  if (!Array.isArray(roh)) return null;
  if (roh.some((h) => typeof h !== "string" || !(PAKET_HEBEL as readonly string[]).includes(h))) return null;
  return PAKET_HEBEL.filter((h) => roh.includes(h));
}

/** Gespeicherten Wert lesen: unbekannte Einträge fallen weg. */
export function hebelAusSpeicher(roh: unknown): HebelArt[] {
  return Array.isArray(roh) ? PAKET_HEBEL.filter((h) => roh.includes(h)) : [];
}

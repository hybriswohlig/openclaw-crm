/**
 * Fixture für verwaiste Fahrzeug-Anpassungen mit echten Rechner-Schlüsseln
 * (Plan 5a, Task E): Klassen- und Stations-IDs sind UUIDs.
 */
import type { Uebersteuerung } from "./kalkulation-versionen";
import { weberErgebnis, weberVersion } from "./kalkulations-ansicht.fixture";

// Echte Schlüssel des Rechners: `fahrzeug.${klassenId}@${stationId}.${teil}`, beide IDs UUIDs.
export const KLASSE = "3f2c9d1e-7a4b-4c8e-9f10-2b3c4d5e6f70";
export const STATION_NEU = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
export const STATION_ALT = "5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9";
export const ALT = `fahrzeug.${KLASSE}@${STATION_ALT}.miete`;
export const NEU = `fahrzeug.${KLASSE}@${STATION_NEU}.miete`;
export const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-/i;

export function ergebnisMitUuid(mietstation = true) {
  const e = weberErgebnis();
  e.kosten!.posten = (e.kosten!.posten ?? []).map((p) =>
    p.key?.startsWith("fahrzeug.sprinter_l.") ? { ...p, key: p.key.replace("fahrzeug.sprinter_l.", `fahrzeug.${KLASSE}@${STATION_NEU}.`) } : p
  );
  if (!mietstation) e.mietstation = null;
  return e;
}

export function uuidVersion(opts: { mietstation?: boolean; wert?: number } = {}) {
  const verwaist: Uebersteuerung = {
    id: "u_verwaist", art: "zeile", key: ALT, rechnerwert: 136.5, wert: opts.wert ?? 120, grund: "Angebot Sixt",
    autor: { userId: "usr_dario", quelle: "mensch" }, zeit: "2026-11-05T10:00:00.000Z", fotoRef: null,
  } as Uebersteuerung;
  const ergebnis = ergebnisMitUuid(opts.mietstation ?? true);
  return weberVersion({ rechnerResult: ergebnis, overrides: [verwaist] });
}


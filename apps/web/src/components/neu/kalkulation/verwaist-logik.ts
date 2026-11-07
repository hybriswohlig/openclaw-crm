/**
 * Verwaiste Fahrzeug-Anpassungen (Plan 5a, Entscheidung 9, F24): reine Logik
 * für „Übertragen“ und „Verwerfen“. Beides schreibt über die bestehende
 * Übersteuerungs-Route (`POST …/overrides`); Löschen ist `wert: null`.
 */
import type { VerwaisteUebersteuerung } from "@/lib/angebot-wahl";
import type { AnpassungAnsicht } from "@/lib/kalkulations-ansicht";
import type { UebersteuerungEingabe } from "./kalk-seite";

const FAHRZEUG_KEY = /^fahrzeug\.([^@.]+)@([^.]+)\.([a-z_]+)$/;

/** Station aus `fahrzeug.<klasse>@<station>.<teil>`, sonst null. */
export function stationAus(key: string): string | null {
  return FAHRZEUG_KEY.exec(key)?.[2] ?? null;
}

/** Anzeigename einer Station aus dem Schlüssel („sixt_esslingen“ → „sixt esslingen“). */
export function stationText(key: string): string {
  const s = stationAus(key);
  return s ? s.replace(/_/g, " ") : key;
}

const WIRKT_NICHT = / \(wirkt nicht[^)]*\)$/;

/** „Sprinter L: Kraftstoff: 20 €“ ohne den Zusatz „(wirkt nicht …)“ der Anpassungsliste. */
export function verwaistText(v: VerwaisteUebersteuerung, a: AnpassungAnsicht | undefined): string {
  return a ? a.text.replace(WIRKT_NICHT, "") : v.key;
}

/** Übertragen geht nur bei genau einem Kandidaten und einem Zahlenwert. */
export function uebertragbar(v: VerwaisteUebersteuerung, a: AnpassungAnsicht | undefined): boolean {
  return v.kandidaten.length === 1 && typeof a?.wert === "number";
}

/**
 * Übertragen: Kandidatenschlüssel mit gleichem Wert und dem Grund
 * „übertragen von {Station}“, danach die alte Anpassung löschen. Die Reihenfolge
 * zählt: bricht der zweite Schritt ab, wirkt der Wert schon an der neuen Zeile.
 */
export function uebertragenEingaben(v: VerwaisteUebersteuerung, a: AnpassungAnsicht | undefined): UebersteuerungEingabe[] {
  if (!uebertragbar(v, a)) return [];
  const ziel = v.kandidaten[0];
  const von = stationAus(v.key) ?? v.key;
  const nach = stationAus(ziel) ?? ziel;
  return [
    { art: "zeile", key: ziel, wert: a!.wert, grund: `übertragen von ${von}` },
    { art: "zeile", key: v.key, wert: null, grund: `übertragen nach ${nach}` },
  ];
}

/** Verwerfen: nur die alte Anpassung löschen. */
export function verwerfenEingaben(v: VerwaisteUebersteuerung): UebersteuerungEingabe[] {
  return [{ art: "zeile", key: v.key, wert: null, grund: "verworfen, die Kostenzeile gibt es nach dem Neurechnen nicht mehr" }];
}

/** Hinweis unter der goldenen Zeile, warum (nicht) übertragen werden kann. */
export function verwaistHinweis(v: VerwaisteUebersteuerung, a: AnpassungAnsicht | undefined): string {
  const station = stationAus(v.key);
  const weg = station
    ? `Der Rechner nimmt das Fahrzeug nicht mehr von ${stationText(v.key)}; die Anpassung wirkt deshalb nicht.`
    : "Die Kostenzeile gibt es nach dem Neurechnen nicht mehr; die Anpassung wirkt deshalb nicht.";
  if (uebertragbar(v, a)) return `${weg} Übertragen setzt denselben Wert an ${stationText(v.kandidaten[0])}.`;
  if (v.kandidaten.length > 1) {
    return `${weg} Es kommen mehrere Stationen in Frage (${v.kandidaten.map(stationText).join(", ")}); bitte verwerfen und die richtige Zeile neu anpassen.`;
  }
  return `${weg} Es gibt keine passende Zeile an einer anderen Station; bitte verwerfen.`;
}

/** Ids der verwaisten Anpassungen: die stehen als goldene Zeile, nicht noch einmal in der Liste. */
export function ohneVerwaiste(anpassungen: AnpassungAnsicht[], verwaist: VerwaisteUebersteuerung[]): AnpassungAnsicht[] {
  if (verwaist.length === 0) return anpassungen;
  const ids = new Set(verwaist.map((v) => v.id));
  return anpassungen.filter((a) => !ids.has(a.id));
}

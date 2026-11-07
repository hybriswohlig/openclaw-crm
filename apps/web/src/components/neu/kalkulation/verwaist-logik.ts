/**
 * Verwaiste Fahrzeug-Anpassungen (Plan 5a, Entscheidung 9, F24): reine Logik
 * für „Übertragen“ und „Verwerfen“. Beides schreibt über die bestehende
 * Übersteuerungs-Route (`POST …/overrides`); Löschen ist `wert: null`.
 * Alle Texte kommen aus der Ansicht (`VerwaistAnsicht`): Schlüssel tragen
 * UUIDs und werden hier nie angezeigt.
 */
import type { AnpassungAnsicht, VerwaistAnsicht } from "@/lib/kalkulations-ansicht";
import type { UebersteuerungEingabe } from "./kalk-seite";

/** Übertragen geht nur bei genau einem Kandidaten und einem Zahlenwert. */
export function uebertragbar(v: VerwaistAnsicht): boolean {
  return v.kandidaten.length === 1 && typeof v.wert === "number";
}

/**
 * Übertragen: Kandidatenschlüssel mit gleichem Wert und dem Grund
 * „übertragen von früherer Station“ (die alte Station hat keinen Namen mehr),
 * danach die alte Anpassung löschen. Die Reihenfolge zählt: bricht der zweite
 * Schritt ab, wirkt der Wert schon an der neuen Zeile.
 */
export function uebertragenEingaben(v: VerwaistAnsicht): UebersteuerungEingabe[] {
  if (!uebertragbar(v)) return [];
  return [
    { art: "zeile", key: v.kandidaten[0], wert: v.wert, grund: "übertragen von früherer Station" },
    { art: "zeile", key: v.key, wert: null, grund: `übertragen nach ${v.kandidatenStation[0]}` },
  ];
}

/** Verwerfen: nur die alte Anpassung löschen. */
export function verwerfenEingaben(v: VerwaistAnsicht): UebersteuerungEingabe[] {
  return [{ art: "zeile", key: v.key, wert: null, grund: "verworfen, die Kostenzeile gibt es nach dem Neurechnen nicht mehr" }];
}

/** Hinweis unter der goldenen Zeile, warum (nicht) übertragen werden kann. */
export function verwaistHinweis(v: VerwaistAnsicht): string {
  const weg = "Der Rechner nimmt das Fahrzeug jetzt von einer anderen Station; die Anpassung wirkt deshalb nicht.";
  if (uebertragbar(v)) return `${weg} Übertragen setzt denselben Wert an ${v.kandidatenStation[0]}.`;
  if (v.kandidaten.length > 1) {
    return `${weg} Es kommen mehrere Zeilen in Frage (${v.kandidatenText.join("; ")}); bitte verwerfen und die richtige Zeile neu anpassen.`;
  }
  return `${weg} Es gibt keine passende Zeile an der neuen Station; bitte verwerfen.`;
}

/** Ids der verwaisten Anpassungen: die stehen als goldene Zeile, nicht noch einmal in der Liste. */
export function ohneVerwaiste(anpassungen: AnpassungAnsicht[], verwaist: readonly { id: string }[]): AnpassungAnsicht[] {
  if (verwaist.length === 0) return anpassungen;
  const ids = new Set(verwaist.map((v) => v.id));
  return anpassungen.filter((a) => !ids.has(a.id));
}

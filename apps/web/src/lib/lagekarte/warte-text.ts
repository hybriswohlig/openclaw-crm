/**
 * Lagekarte: Wartezeit als kurzer Text, eine Regel für Liste und Panel.
 * Abgerundet: unter 1 Min. „gerade eben“, dann „seit 12 Min.“, „seit 3 Std.“,
 * ab 24 Std. „seit gestern“, ab 48 Std. „seit 4 Tagen“. Zeitpunkte in der
 * Zukunft (Uhrzeit-Versatz) gelten als „gerade eben“.
 */
const MIN_MS = 60_000;

export function warteText(seit: string, jetzt: Date): string {
  const ab = new Date(seit).getTime();
  if (Number.isNaN(ab)) return "";
  const minuten = Math.floor(Math.max(0, jetzt.getTime() - ab) / MIN_MS);
  if (minuten < 1) return "gerade eben";
  if (minuten < 60) return `seit ${minuten} Min.`;
  const stunden = Math.floor(minuten / 60);
  if (stunden < 24) return `seit ${stunden} Std.`;
  const tage = Math.floor(stunden / 24);
  return tage === 1 ? "seit gestern" : `seit ${tage} Tagen`;
}

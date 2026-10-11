/**
 * Raster im „Mehr“-Blatt der mobilen Tab-Leiste: drei Kacheln je Reihe auf
 * sechs Spalten, jede Kachel zwei Spalten breit. Bleibt die letzte Reihe
 * unvollständig, rückt ihre erste Kachel um die halbe Lücke ein: zwei Kacheln
 * um eine Spalte, eine Kachel um zwei. So steht der Rest mittig statt links
 * mit leerem Platz daneben, und die Reihenfolge der Einträge bleibt.
 */
const KACHELN_JE_REIHE = 3;

/** Wert für grid-column der Kachel an Stelle `index` von `anzahl` Kacheln. */
export function mehrKachelSpalte(index: number, anzahl: number): string {
  const rest = anzahl % KACHELN_JE_REIHE;
  if (rest > 0 && index === anzahl - rest) {
    return `${KACHELN_JE_REIHE - rest + 1} / span 2`;
  }
  return "span 2";
}

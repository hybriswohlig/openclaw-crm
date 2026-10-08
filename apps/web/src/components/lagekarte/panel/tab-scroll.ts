/**
 * Lagekarte, Lead-Panel: wo „Angebot“ und „Verlauf“ beim ersten Besuch im
 * gemeinsamen Scrollbereich (Rumpf) beginnen. Rein, ohne DOM.
 */

/** So viel Tab-Inhalt muss unter der Tab-Leiste sichtbar sein, damit „oben“ reicht. */
export const MIN_INHALT_SICHTBAR_PX = 120;

/**
 * Oben (0), solange der Tab-Inhalt dann noch sichtbar beginnt: Fakten und
 * Aktionen bleiben im Blick (Desktop). Sonst klebt die Tab-Leiste oben und der
 * Inhalt steht direkt darunter (mobil: sonst läge beides unter dem Rand, der
 * Tab schiene nicht zu reagieren).
 *
 * @param tabsOben natürliche Oberkante der Tab-Leiste im Rumpf (ohne Kleben)
 * @param tabsHoehe Höhe der Tab-Leiste
 * @param sichtHoehe sichtbare Höhe des Rumpfs (clientHeight)
 */
export function startScrollFuerTab(tabsOben: number, tabsHoehe: number, sichtHoehe: number): number {
  return tabsOben + tabsHoehe <= sichtHoehe - MIN_INHALT_SICHTBAR_PX ? 0 : tabsOben;
}

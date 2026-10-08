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

/**
 * Chat am Ende: Höhe der Lücke unter der neuesten Nachricht, damit die oberste sichtbare Blase
 * nicht halb unter der klebenden Tab-Leiste liegt. Die Lücke ist der noch sichtbare Rest der
 * angeschnittenen Blase; nach dem Scrollen ans (neue) Ende liegt sie ganz über der Kante und die
 * nächste Blase beginnt direkt unter der Tab-Leiste. Die neueste Blase wird nie weggeschoben.
 *
 * @param blasen Ober- und Unterkante der Blasen (Bildschirm-Pixel), älteste zuerst
 * @param sichtOben Unterkante der klebenden Tab-Leiste (Bildschirm-Pixel)
 */
export function chatLuecke(blasen: ReadonlyArray<{ oben: number; unten: number }>, sichtOben: number): number {
  for (let i = 0; i < blasen.length; i++) {
    const b = blasen[i];
    if (b.unten <= sichtOben) continue;
    if (b.oben >= sichtOben || i === blasen.length - 1) return 0;
    return Math.ceil(b.unten - sichtOben);
  }
  return 0;
}

/**
 * Ohne Abhängigkeiten (auch im Browser-Bundle über kalkulation-versionen.ts), daher nicht in eingabe.ts.
 */
type Anfrage = Record<string, unknown>;

/** Felder, die bei Küchenmontage nicht an den Rechner gehen: Ziel, Umzugsgut, Kartons, Volumen. */
const NICHT_BEI_KUECHE = [
  "nach_vorhanden",
  "nach_halteverbot",
  "positionen_freitext",
  "umzugskartons",
  "einpack_kartons",
  "einpack_ohne_anzahl",
  "volumen_cbm_vorgabe",
  "zimmer",
  "wohnflaeche_qm",
];
/** Küchenfelder, die nur bei Umzug (Küche mitnehmen) oder Küchenmontage gelten. */
const KUECHEN_FELDER = ["kueche_meter", "kueche_meter_oben", "kueche_demontage", "kueche_montage", "kueche_hochtragen", "kueche_mitnehmen"];

/**
 * Letzter Schritt vor dem Rechner (Review 19.11.): Küchenmontage ohne Ziel, Möbelliste, Kartons
 * und Volumen (sonst Team, Material und ein Möbel-Montageposten aus dem Umzugsgut); Entrümpelung
 * ohne Küchenfelder. Die Grundlage kann diese Werte dort nicht zeigen, also gehen sie nicht mit.
 */
export function kuecheBereinigen<T extends Anfrage>(a: T): T {
  if (a.auftragsart === "kuechenmontage") for (const f of NICHT_BEI_KUECHE) delete a[f];
  if (a.auftragsart === "entruempelung") for (const f of KUECHEN_FELDER) delete a[f];
  return a;
}

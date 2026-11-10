/**
 * Entscheidung vor KV, AB und Rechnung in der neuen Oberfläche (rein): erst
 * prüfen, dann den Dokumentdialog öffnen. Nie einen Job starten, der absehbar
 * scheitert („Kundenanschrift fehlt“). Gleiche Regeln wie das Fenster der alten
 * Oberfläche (`kvVorpruefung`).
 */
import { buildDealDataForDocs, type LeadContext } from "@/lib/deal-doc-data";
import { kvVorpruefung, type DokumentArt, type KvHinweisDaten, type Vorpruefung } from "@/lib/kv-vorpruefung";

/** Deal-Daten des Dokumentdialogs (Typ über deal-doc-data, ohne den alten Dialog zu importieren). */
type DealData = NonNullable<ReturnType<typeof buildDealDataForDocs>>;

export type DokumentStart =
  | { art: "firma_fehlt" }
  | { art: "preis_fehlt" }
  | { art: "angaben"; pruefung: Vorpruefung }
  | { art: "bereit"; deal: DealData };

export function dokumentStart(
  dealId: string,
  ctx: LeadContext | null,
  daten: KvHinweisDaten | null,
  art: DokumentArt
): DokumentStart {
  const pruefung = kvVorpruefung({ ctx, daten, documentType: art });
  if (pruefung.firmaFehlt) return { art: "firma_fehlt" };
  if (pruefung.preisFehlt) return { art: "preis_fehlt" };
  const deal = ctx ? buildDealDataForDocs(dealId, ctx) : null;
  // Die Vorlage braucht kunde.adresse (Auszug) und den Namen: ohne beides nie weiter.
  if (!pruefung.bereit) return { art: "angaben", pruefung };
  if (!deal || !deal.kunde.adresse) {
    // Sicherheitsnetz, falls Vorprüfung und Vorlage je verschieden lesen: Name und Auszug abfragen.
    const felder = pruefung.felder.map((f) =>
      (f.feld === "auszug" && !deal?.kunde.adresse) || (f.feld === "kundenname" && !deal) ? { ...f, fehlt: true } : f
    );
    return { art: "angaben", pruefung: { ...pruefung, felder, bereit: false } };
  }
  // Leistung vorbelegen wie die alte Oberfläche: sonst stünde eine Entrümpelung im Dialog als Umzug.
  return { art: "bereit", deal: daten?.leistungsart ? { ...deal, serviceType: daten.leistungsart } : deal };
}

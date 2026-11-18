/**
 * Vorprüfung vor dem Erzeugen eines Dokuments (KV, AB, RE).
 *
 * Pflichtfelder sind genau die Angaben, ohne die die Vorlage auf crm-tools
 * abbricht („Kundenanschrift fehlt“, „Umzug.von.Adresse fehlt“). Sie lassen
 * sich im Fenster „Es fehlen noch Angaben“ direkt nachtragen. Hinweise
 * blockieren nicht, sie zeigen nur, was im KV fehlen oder vereinfacht wird.
 */
import { resolveCustomerNameForDocs, type LeadContext } from "./deal-doc-data";
import { gleicheAdresse, locationValueToText } from "./adresse";
import { leistungAusText, type PortalLeistung } from "@openclaw-crm/customer-portal-core";

export type DokumentArt = "KV" | "AB" | "RE";
export type PflichtFeld = "kundenname" | "auszug" | "einzug" | "datum";
export type HinweisArt = "umzugsgut" | "preis";

/** Zusatzdaten aus GET /api/v1/deals/:id/auftrag (kvHinweise). */
export interface KvHinweisDaten {
  umzugsgutAnzahl: number;
  /** Fotos, die gerade ausgewertet werden oder noch drankommen. */
  fotosOffen: number;
  /** Fotos, die nicht ausgewertet werden konnten (fehlt bei älteren Antworten). */
  fotosGescheitert?: number;
  hatAngebot: boolean;
  /**
   * Gesetzt, wenn der KV den Festpreis als eine Zeile „Pauschale“ druckt
   * (festpreisAlsPauschale): ohne bepreiste Posten oder wenn sie ihn nicht ergeben.
   */
  festpreisCents: number | null;
  /** Neueste Unterhaltung des Deals, für den Sprung in den Posteingang. */
  conversationId: string | null;
  /** Vorbelegung der Leistung im KV-Dialog (fehlt bei älteren Antworten). */
  leistungsart?: PortalLeistung;
}

/**
 * Leistung im KV-Dialog vorbelegen: gespeicherte Küche oder Entrümpelung
 * zuerst, sonst eine Entrümpelungs-Anfrage als Entrümpelung, sonst Umzug.
 * „move“ ist der Spalten-Default und zählt deshalb nicht als Wahl.
 */
/**
 * Vorbelegung der Leistung im KV-Dialog. Reihenfolge: gespeicherte Küche oder
 * Entrümpelung, gespeicherter Umzug mit Entrümpelung, Entrümpelungs-Anfrage,
 * dann der Angebotstext (z. B. „IKEA-Küchenmontage“), sonst Umzug. „move“ ist
 * auch der Spalten-Default, deshalb zählt ein gespeicherter Umzug allein nicht.
 */
export function leistungsartVorschlag(input: {
  gespeichert: string | null;
  leadType: string | null;
  mitEntruempelung?: boolean | null;
  /** documentDetails.leistungBestaetigt: ein gespeicherter Umzug ist dann bewusst gewählt. */
  bestaetigt?: boolean | null;
  text?: string | null;
}): PortalLeistung {
  if (input.gespeichert === "kitchen_installation" || input.gespeichert === "clearance") return input.gespeichert;
  if (input.gespeichert === "move" && input.mitEntruempelung === true) return "clearance_move";
  if (input.gespeichert === "move" && input.bestaetigt === true) return "move";
  if (input.leadType?.toLowerCase() === "entruempelung") return "clearance";
  return leistungAusText(input.text) ?? "move";
}

/**
 * Pflichtfelder je Leistung (Review M4). Entrümpelung ohne Umzug hat kein Ziel, die
 * Einzugsadresse ist dann keine Pflicht; Umzug und Umzug mit Entrümpelung brauchen sie.
 * Küchenmontage: die Einbauadresse steht im Dokumentdialog (sonst die Einzugsadresse).
 */
export function pflichtJeLeistung(leistung: PortalLeistung | null | undefined): PflichtFeld[] {
  return leistung === "clearance" || leistung === "kitchen_installation"
    ? ["kundenname", "auszug", "datum"]
    : ["kundenname", "auszug", "einzug", "datum"];
}

/**
 * Prüfung im Dokumentdialog, wenn dort die Leistung gewechselt wird: was für die
 * gewählte Leistung im Auftrag fehlt (deutsche Bezeichnungen), leer wenn alles da ist.
 */
export function fehltFuerLeistung(
  leistung: PortalLeistung,
  deal: { kunde: { nachname?: string; adresse?: string }; auftrag: { strecke_nach?: string; datum?: string } },
  einbauadresse?: string
): string[] {
  const da: Record<PflichtFeld, boolean> = {
    kundenname: !!deal.kunde.nachname?.trim(),
    auszug: !!deal.kunde.adresse?.trim(),
    einzug: !!deal.auftrag.strecke_nach?.trim(),
    datum: !!deal.auftrag.datum?.trim(),
  };
  const fehlt = pflichtJeLeistung(leistung).filter((f) => !da[f]).map((f) => labelFuer(f, leistung));
  if (leistung === "kitchen_installation" && !einbauadresse?.trim() && !da.einzug) fehlt.push("Einbauadresse");
  return fehlt;
}

export interface Vorpruefung {
  felder: Array<{ feld: PflichtFeld; label: string; wert: string; fehlt: boolean; grund?: string }>;
  firmaFehlt: boolean;
  /** AB und RE brauchen ein gespeichertes Angebot. */
  preisFehlt: boolean;
  hinweise: Array<{ art: HinweisArt; text: string }>;
  bereit: boolean;
}

export const EINZUG_GLEICH_TEXT = "Die Einzugsadresse ist gleich der Auszugsadresse. Bitte die neue Adresse eintragen.";

const LABEL: Record<PflichtFeld, string> = {
  kundenname: "Kundenname",
  auszug: "Auszugsadresse",
  einzug: "Einzugsadresse",
  datum: "Umzugsdatum",
};

/** Bei einer Entrümpelung heißt die Adresse des Leads Einsatzort und das Datum Termin. */
const LABEL_ENTRUEMPELUNG: Partial<Record<PflichtFeld, string>> = { auszug: "Einsatzort", datum: "Termin" };

export function labelFuer(feld: PflichtFeld, leistung: PortalLeistung | null | undefined): string {
  return (leistung === "clearance" ? LABEL_ENTRUEMPELUNG[feld] : undefined) ?? LABEL[feld];
}

function adresse(v: unknown): string {
  return locationValueToText(v);
}

export function kvVorpruefung(input: {
  ctx: LeadContext | null;
  daten: KvHinweisDaten | null;
  documentType: DokumentArt;
}): Vorpruefung {
  const { ctx, daten } = input;
  const name = ctx ? resolveCustomerNameForDocs(ctx) : null;
  const werte: Record<PflichtFeld, string> = {
    kundenname: name ? [name.vorname, name.nachname].filter(Boolean).join(" ") : "",
    auszug: ctx ? adresse(ctx.move_from_address) : "",
    einzug: ctx ? adresse(ctx.move_to_address) : "",
    datum: ctx?.move_date ?? "",
  };
  const pflicht = pflichtJeLeistung(daten?.leistungsart);
  // KV-Meldung 10.11.: nie still die Auszugsadresse als Einzug drucken.
  const einzugGleich = !!ctx && gleicheAdresse(ctx.move_from_address, ctx.move_to_address);
  const felder = pflicht.map((feld) => ({
    feld,
    label: labelFuer(feld, daten?.leistungsart),
    wert: werte[feld],
    fehlt: !werte[feld].trim() || (feld === "einzug" && einzugGleich),
    ...(feld === "einzug" && einzugGleich && werte[feld].trim() ? { grund: EINZUG_GLEICH_TEXT } : {}),
  }));
  const firmaFehlt = !ctx?.operating_company;
  const preisFehlt = input.documentType !== "KV" && !daten?.hatAngebot;

  const hinweise: Vorpruefung["hinweise"] = [];
  if (input.documentType === "KV" && daten) {
    const fotos = (n: number, eins: string, viele: string) => `${n} ${n === 1 ? eins : viele}`;
    const offen = fotos(daten.fotosOffen, "Foto wird", "Fotos werden");
    // Bei einer Entrümpelung ist die Liste die der Gegenstände, nicht das Umzugsgut.
    const liste = daten.leistungsart === "clearance" ? "Die Liste der Gegenstände" : "Umzugsgut";
    if (daten.umzugsgutAnzahl === 0) {
      hinweise.push({
        art: "umzugsgut",
        text:
          daten.fotosOffen > 0
            ? `${liste} ist noch leer, ${offen} gerade ausgewertet.`
            : `${liste} ist leer. Im KV steht dann keine Liste.`,
      });
    } else if (daten.fotosOffen > 0) {
      // Teilweise gefüllt: sonst sähe eine halbe Liste fertig aus.
      hinweise.push({
        art: "umzugsgut",
        text: `${liste} hat ${daten.umzugsgutAnzahl} Einträge, ${offen} noch ausgewertet.`,
      });
    }
    const gescheitert = daten.fotosGescheitert ?? 0;
    if (gescheitert > 0) {
      hinweise.push({
        art: "umzugsgut",
        text: `${fotos(gescheitert, "Foto konnte", "Fotos konnten")} nicht ausgewertet werden. Bitte ${daten.leistungsart === "clearance" ? "die Liste der Gegenstände" : "das Umzugsgut"} mit den Fotos im Posteingang vergleichen.`,
      });
    }
    const ceylan = /ceylan/i.test(ctx?.operating_company?.displayName ?? "");
    if (daten.festpreisCents != null && !ceylan) {
      const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(daten.festpreisCents / 100);
      hinweise.push({ art: "preis", text: `Im KV steht der Preis als eine Pauschale (${euro}).` });
    }
  }

  return {
    felder,
    firmaFehlt,
    preisFehlt,
    hinweise,
    bereit: felder.every((f) => !f.fehlt) && !firmaFehlt && !preisFehlt,
  };
}

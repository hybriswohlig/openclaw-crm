/**
 * Vorprüfung vor dem Erzeugen eines Dokuments (KV, AB, RE).
 *
 * Pflichtfelder sind genau die Angaben, ohne die die Vorlage auf crm-tools
 * abbricht („Kundenanschrift fehlt“, „Umzug.von.Adresse fehlt“). Sie lassen
 * sich im Fenster „Es fehlen noch Angaben“ direkt nachtragen. Hinweise
 * blockieren nicht, sie zeigen nur, was im KV fehlen oder vereinfacht wird.
 */
import { resolveCustomerNameForDocs, type LeadContext } from "./deal-doc-data";
import { locationValueToText } from "./adresse";
import type { ServiceArt } from "@openclaw-crm/customer-portal-core";

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
  /** Gesetzt, wenn das Angebot nur einen Festpreis ohne Posten hat. */
  festpreisCents: number | null;
  /** Neueste Unterhaltung des Deals, für den Sprung in den Posteingang. */
  conversationId: string | null;
  /** Vorbelegung der Leistung im KV-Dialog (fehlt bei älteren Antworten). */
  leistungsart?: ServiceArt;
}

/**
 * Leistung im KV-Dialog vorbelegen: gespeicherte Küche oder Entrümpelung
 * zuerst, sonst eine Entrümpelungs-Anfrage als Entrümpelung, sonst Umzug.
 * „move“ ist der Spalten-Default und zählt deshalb nicht als Wahl.
 */
export function leistungsartVorschlag(input: { gespeichert: string | null; leadType: string | null }): ServiceArt {
  if (input.gespeichert === "kitchen_installation" || input.gespeichert === "clearance") return input.gespeichert;
  return input.leadType?.toLowerCase() === "entruempelung" ? "clearance" : "move";
}

export interface Vorpruefung {
  felder: Array<{ feld: PflichtFeld; label: string; wert: string; fehlt: boolean }>;
  firmaFehlt: boolean;
  /** AB und RE brauchen ein gespeichertes Angebot. */
  preisFehlt: boolean;
  hinweise: Array<{ art: HinweisArt; text: string }>;
  bereit: boolean;
}

const LABEL: Record<PflichtFeld, string> = {
  kundenname: "Kundenname",
  auszug: "Auszugsadresse",
  einzug: "Einzugsadresse",
  datum: "Umzugsdatum",
};

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
  const felder = (Object.keys(LABEL) as PflichtFeld[]).map((feld) => ({
    feld,
    label: LABEL[feld],
    wert: werte[feld],
    fehlt: !werte[feld].trim(),
  }));
  const firmaFehlt = !ctx?.operating_company;
  const preisFehlt = input.documentType !== "KV" && !daten?.hatAngebot;

  const hinweise: Vorpruefung["hinweise"] = [];
  if (input.documentType === "KV" && daten) {
    const fotos = (n: number, eins: string, viele: string) => `${n} ${n === 1 ? eins : viele}`;
    const offen = fotos(daten.fotosOffen, "Foto wird", "Fotos werden");
    if (daten.umzugsgutAnzahl === 0) {
      hinweise.push({
        art: "umzugsgut",
        text:
          daten.fotosOffen > 0
            ? `Umzugsgut ist noch leer, ${offen} gerade ausgewertet.`
            : "Umzugsgut ist leer. Im KV steht dann keine Liste.",
      });
    } else if (daten.fotosOffen > 0) {
      // Teilweise gefüllt: sonst sähe eine halbe Liste fertig aus.
      hinweise.push({
        art: "umzugsgut",
        text: `Umzugsgut hat ${daten.umzugsgutAnzahl} Einträge, ${offen} noch ausgewertet.`,
      });
    }
    const gescheitert = daten.fotosGescheitert ?? 0;
    if (gescheitert > 0) {
      hinweise.push({
        art: "umzugsgut",
        text: `${fotos(gescheitert, "Foto konnte", "Fotos konnten")} nicht ausgewertet werden. Bitte das Umzugsgut mit den Fotos im Posteingang vergleichen.`,
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

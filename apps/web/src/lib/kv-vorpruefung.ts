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

export type DokumentArt = "KV" | "AB" | "RE";
export type PflichtFeld = "kundenname" | "auszug" | "einzug" | "datum";
export type HinweisArt = "umzugsgut" | "preis";

/** Zusatzdaten aus GET /api/v1/deals/:id/auftrag (kvHinweise). */
export interface KvHinweisDaten {
  umzugsgutAnzahl: number;
  fotoStapelOffen: number;
  hatAngebot: boolean;
  /** Gesetzt, wenn das Angebot nur einen Festpreis ohne Posten hat. */
  festpreisCents: number | null;
  /** Neueste Unterhaltung des Deals, für den Sprung in den Posteingang. */
  conversationId: string | null;
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
    if (daten.umzugsgutAnzahl === 0) {
      hinweise.push({
        art: "umzugsgut",
        text:
          daten.fotoStapelOffen > 0
            ? `Umzugsgut ist noch leer, ${daten.fotoStapelOffen} Foto-Stapel werden gerade ausgewertet.`
            : "Umzugsgut ist leer. Im KV steht dann keine Liste.",
      });
    } else if (daten.fotoStapelOffen > 0) {
      // Teilweise gefüllt: sonst sähe eine halbe Liste fertig aus.
      hinweise.push({
        art: "umzugsgut",
        text: `Umzugsgut hat ${daten.umzugsgutAnzahl} Einträge, ${daten.fotoStapelOffen} Foto-Stapel werden noch ausgewertet.`,
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

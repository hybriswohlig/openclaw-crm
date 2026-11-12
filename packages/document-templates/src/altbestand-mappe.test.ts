/**
 * Sperre der Vertragsmappe ohne Plan-5b-Felder (Nachtrag D2).
 *
 * Verglichen werden Annahmeseiten-Modell und Textzeilen vollständig und der
 * Seiteninhalt der Annahmeseite als Hash. Die Golddatei enthält den
 * Restbetrag-Satz am Umzugstag für jede Firma.
 *
 * Neu schreiben, wenn der gedruckte Text absichtlich geändert wurde:
 * GOLDEN_SCHREIBEN=<pfad> npx vitest run src/altbestand-mappe.test.ts
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { annahmeSeiteModell, annahmeSeiteZeilen, baueVertragsmappe, type VertragsmappeDaten } from "./vertragsmappe";

const basis: VertragsmappeDaten = {
  firma: "Kottke Dienstleistungen", dealNumber: "K-1042", kunde: "Anna Muster",
  preisCents: 175000, voraussichtlich: false, optionName: null, leistung: "Umzug",
  moveDate: "2026-11-26", fromAddress: "Hauptstr. 5, 72202 Nagold", toAddress: "Gartenweg 2, 70173 Stuttgart",
  angenommenAm: new Date("2026-10-22T08:15:00Z"), annahmeIp: "203.0.113.5",
  agbVersion: "kottke-2026-10", agbTextSha256: "ab".repeat(32), agbText: "§ 1 Geltung\nDiese AGB gelten für alle Umzüge.",
  kvSha256: "cd".repeat(32),
  widerrufHinweis: "Für Umzugsaufträge mit festem Termin besteht kein gesetzliches Widerrufsrecht (§ 312g Abs. 2 Satz 1 Nr. 9 BGB).",
  haftungshinweis: true, versicherungGewuenscht: false,
  erklaerung: "Mit meiner Unterschrift bestätige ich den oben bezeichneten Vertrag.",
  unterschrift: { art: "getippt", name: "Anna Muster", bildPng: null, at: new Date("2026-10-22T08:20:00Z"), ip: "203.0.113.5" },
  marke: { firmaSlug: "kottke", leistung: "move", akzentHex: "c2570c", ansprechpartner: "Dario Kottke", fusszeile: "Kottke Dienstleistungen · Marktstr. 8 · 72218 Wildberg" },
};

/** Beispiele vor 5b. Nur anhängen, nie ändern. */
const BEISPIELE: Array<[string, VertragsmappeDaten]> = [
  ["festpreis", basis],
  ["option", { ...basis, optionName: "Komfort", preisCents: 189000 }],
  ["stunden-alt", { ...basis, voraussichtlich: true, preisCents: 9500, haftungshinweis: false, widerrufHinweis: null }],
  ["ohne-adressen-ceylan", { ...basis, fromAddress: null, toAddress: null, moveDate: null, kunde: null, marke: { ...basis.marke, firmaSlug: "ceylan", ansprechpartner: null, fusszeile: null } }],
  ["felder-leer", { ...basis, optionName: "Premium", gewaehlt: null, preisAngabe: null } as VertragsmappeDaten],
];

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

async function leeresKv(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  return doc.save();
}

/** Seiteninhalt der Annahmeseite (Seite 2) ohne zufällige Namenszusätze. */
async function annahmeSeite(pdf: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(pdf);
  const page = doc.getPage(1);
  const c = page.node.Contents();
  const streams = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
  return streams
    .map((s) => (s instanceof PDFRawStream ? inflateSync(Buffer.from(s.contents)).toString("latin1") : String(s)))
    .join("\n")
    .replace(/\/([A-Za-z]+(?:-[A-Za-z]+)*)-\d+/g, "/$1");
}

const GOLDEN = new URL("./altbestand-mappe.golden.json", import.meta.url);

describe("Vertragsmappe ohne Wahl und ohne Preisangabe", () => {
  it("bleibt wie die Golddatei", async () => {
    const jetzt: Record<string, unknown> = {};
    for (const [name, d] of BEISPIELE) {
      jetzt[name] = {
        modell: JSON.parse(JSON.stringify(annahmeSeiteModell(d))) as unknown,
        zeilen: annahmeSeiteZeilen(d),
        seite: sha(await annahmeSeite(await baueVertragsmappe(await leeresKv(), d))),
      };
    }
    const ziel = process.env.GOLDEN_SCHREIBEN;
    if (ziel) {
      writeFileSync(ziel, `${JSON.stringify(jetzt, null, 2)}\n`);
      return;
    }
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, unknown>;
    expect(Object.keys(jetzt)).toEqual(Object.keys(golden));
    for (const name of Object.keys(golden)) expect({ name, ...(jetzt[name] as object) }).toEqual({ name, ...(golden[name] as object) });
  });
});

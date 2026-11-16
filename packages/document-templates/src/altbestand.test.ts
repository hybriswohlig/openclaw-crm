/**
 * Sperre gegen unbeabsichtigte Textänderungen (Plan 5b, Task D2).
 *
 * Jedes Beispiel wird mit der heutigen Vorlage gebaut, die Versionsangabe
 * auf `kv-ab-re/4` zurückgesetzt und mit der Golddatei verglichen: Modell
 * vollständig, HTML und Seiteninhalt des PDFs als Hash. Die Golddatei
 * enthält den aktuellen Zahltext (Restbetrag am Umzugs- oder Einsatztag).
 *
 * Neu schreiben, wenn der gedruckte Text absichtlich geändert wurde:
 * GOLDEN_SCHREIBEN=<pfad> npx vitest run src/altbestand.test.ts
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildDocumentModel } from "./model";
import { priceSourceFromStored } from "./prices";
import { renderHtml } from "./html";
import { renderPdf } from "./pdf";
import type { DealFacts, PriceLine, QuotationPriceSource, RenderInput } from "./types";

const ALTE_VERSION = "kv-ab-re/4";

const deal: DealFacts = {
  firma: "kottke",
  customerName: "Kyra Heiker",
  customerEmail: "kyra@example.com",
  customerAddress: "Marktstr. 1, 72218 Wildberg",
  fromAddress: "Hauptstr. 5, 72202 Nagold",
  toAddress: "Gartenweg 2, 70173 Stuttgart",
  serviceDate: "2026-11-03",
  documentDate: "2026-10-16",
};
const ceylan: DealFacts = { ...deal, firma: "ceylan" };

function lines(items: Array<[string, number, string, string?]>): PriceLine[] {
  return items.map(([description, quantity, unitRate, type]) => ({
    type: type ?? "other",
    description,
    quantity,
    unitRate,
  }));
}

function quotation(over: Partial<QuotationPriceSource> = {}): QuotationPriceSource {
  return {
    isVariable: false,
    fixedPrice: "1847.65",
    lineItems: [],
    depositRequiredCents: 40000,
    paymentMethodPreference: "cash",
    validUntil: "2026-11-30",
    summary: "Transport einer Waschmaschine inkl. einem Helfer",
    serviceType: "move",
    ...over,
  };
}

const stundenAlt = (documentDetails: unknown) =>
  priceSourceFromStored({
    isVariable: true,
    fixedPrice: null,
    lineItems: lines([
      ["Helfer", 2, "35.00", "helper"],
      ["Transporter", 1, "25.00", "transporter"],
    ]),
    depositRequiredCents: null,
    paymentMethodPreference: "bank_transfer",
    validUntil: null,
    summary: "Umzug nach Aufwand",
    serviceType: "move",
    documentDetails,
  });

/** Beispiele aus dem Bestand vor 5b. Nur anhängen, nie ändern. */
const BEISPIELE: Array<[string, RenderInput]> = [
  ["kv-festpreis-falscher-posten", { kind: "KV", deal, quotation: quotation({ lineItems: lines([["Falsch", 1, "9999.00"]]) }) }],
  [
    "kv-posten-ergeben-festpreis",
    {
      kind: "KV",
      deal: ceylan,
      quotation: quotation({
        fixedPrice: "1720.00",
        lineItems: lines([
          ["Umzug Kern", 1, "1500.00"],
          ["Halteverbot", 2, "110.00"],
        ]),
        paymentMethodPreference: "bank_transfer",
      }),
    },
  ],
  [
    "kv-paket-passt-nicht",
    {
      kind: "KV",
      deal: ceylan,
      quotation: quotation({ fixedPrice: "1720.00", lineItems: lines([["Umzug Kern", 1, "1720.00"]]) }),
      packageOption: { displayName: "Premium", priceCents: 189000, includedItems: ["Halteverbot inklusive"] },
    },
  ],
  [
    "kv-paket-passt",
    {
      kind: "KV",
      deal: ceylan,
      quotation: quotation({ fixedPrice: "1890.00", lineItems: lines([["Komfort", 1, "1890.00"]]) }),
      packageOption: { displayName: "Komfort", priceCents: 189000, includedItems: [] },
    },
  ],
  ["kv-stunden-alt", { kind: "KV", deal: ceylan, quotation: stundenAlt(null) }],
  ["kv-stunden-alt-andere-details", { kind: "KV", deal: ceylan, quotation: stundenAlt({ stunden: { quelle: "alt" }, time: "8 Uhr" }) }],
  [
    "ab-annahme",
    {
      kind: "AB",
      deal,
      quotation: quotation(),
      accepted: { isVariable: false, fixedPrice: "1890.00", lineItems: [] },
    },
  ],
  [
    "re-stunden-bezahlt",
    {
      kind: "RE",
      deal: ceylan,
      quotation: quotation({
        isVariable: true,
        fixedPrice: null,
        lineItems: lines([
          ["Helfer", 3, "45.00", "helper"],
          ["Transporter", 4, "30.00", "transporter"],
        ]),
        paymentMethodPreference: "card",
      }),
      paidCents: 10000,
    },
  ],
  [
    "kv-du-firma-rabatt",
    {
      kind: "KV",
      deal: { ...ceylan, customerName: "Roman Rothe", customerCompany: "Sport-Thieme GmbH", addressForm: "du" },
      quotation: quotation({
        fixedPrice: "920.00",
        depositRequiredCents: null,
        paymentMethodPreference: "bank_transfer",
        lineItems: lines([
          ["Büroumzug", 1, "990.00"],
          ["Rabatt bei Termin Mo-Do", 1, "-70.00"],
        ]),
      }),
    },
  ],
  [
    "kv-du-privat",
    { kind: "KV", deal: { ...ceylan, addressForm: "du", givenName: "Kyra" }, quotation: quotation({ fixedPrice: "650.00" }) },
  ],
];

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Seiteninhalt ohne die zufälligen Namenszusätze von pdf-lib (Schrift- und Bildnamen). */
async function seitenInhalt(pdf: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(pdf);
  return doc
    .getPages()
    .map((page) => {
      const c = page.node.Contents();
      const streams = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
      return streams
        .map((s) => (s instanceof PDFRawStream ? inflateSync(Buffer.from(s.contents)).toString("latin1") : String(s)))
        .join("\n");
    })
    .join("\f")
    .replace(/\/([A-Za-z]+(?:-[A-Za-z]+)*)-\d+/g, "/$1");
}

async function abdruck(input: RenderInput) {
  const model = { ...buildDocumentModel(input), templateVersion: ALTE_VERSION };
  return {
    model: JSON.parse(JSON.stringify(model)) as unknown,
    html: sha(renderHtml(model)),
    pdf: sha(await seitenInhalt(await renderPdf(model))),
  };
}

const GOLDEN = new URL("./altbestand.golden.json", import.meta.url);

describe("Altbestand ohne Wahl und ohne Stunden aus der Version", () => {
  it("rendert wie die Golddatei, bis auf die Versionsangabe", async () => {
    const jetzt: Record<string, unknown> = {};
    for (const [name, input] of BEISPIELE) jetzt[name] = await abdruck(input);
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

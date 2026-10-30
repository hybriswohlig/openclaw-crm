import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildDocumentModel } from "./model";
import { renderHtml } from "./html";
import { renderPdf } from "./pdf";
import { composeDocumentCopy, selectDocumentService } from "./copy";
import { TEMPLATE_VERSION } from "./version";
import type { DealFacts, DocKind, QuotationPriceSource, ServiceSignals } from "./types";

const EURO = /€|\bEUR\b|\d+[.,]\d{2}/;
const MOVE_ONLY = /Umzug|Pauschale/;
const SIE_PRONOUN = /\b(Ihnen|Ihre|Ihren|Sie)\b/;
const DU_PRONOUN = /\b(dir|dein|deine|deinen|deinem|du)\b/i;

const deal: DealFacts = {
  firma: "kottke",
  customerName: "Kyra Heiker",
  givenName: "Kyra",
  customerAddress: "Marktstr. 1, 72218 Wildberg",
  serviceDate: "2026-11-03",
  documentDate: "2026-10-16",
};

function quotation(over: Partial<QuotationPriceSource> = {}): QuotationPriceSource {
  return {
    isVariable: false,
    fixedPrice: "890.00",
    lineItems: [],
    depositRequiredCents: 20000,
    paymentMethodPreference: "bank_transfer",
    validUntil: "2026-11-30",
    summary: "Leistung laut Angebot",
    serviceType: "move",
    ...over,
  };
}

function spoken(kind: DocKind, serviceType: string, signals?: ServiceSignals, addressForm?: "sie" | "du") {
  const composed = composeDocumentCopy({
    kind,
    serviceType,
    signals,
    addressForm,
    customerName: deal.customerName,
    givenName: deal.givenName,
    serviceDate: deal.serviceDate,
    methodLabel: "Überweisung",
    hasDeposit: true,
    openCents: null,
  });
  return {
    composed,
    text: [...composed.intro, ...composed.closing, composed.paymentTerms ?? ""].join("\n"),
  };
}

describe("selectDocumentService", () => {
  it("keeps a household move, including a Fernumzug lead", () => {
    expect(selectDocumentService("move")).toEqual({ kind: "move", label: "Umzug" });
    expect(selectDocumentService("move", { leadType: "umzug", showStandardInclusions: true })).toEqual({
      kind: "move",
      label: "Umzug",
    });
    expect(selectDocumentService("move", { leadType: "fmz" })).toEqual({
      kind: "move",
      label: "Fernumzug",
    });
    expect(selectDocumentService("move", { leadType: "Fernumzug" })).toEqual({
      kind: "move",
      label: "Fernumzug",
    });
  });

  it("lets a stored Küche or Entrümpelung win over the lead", () => {
    expect(selectDocumentService("kitchen_installation", { leadType: "umzug" })).toEqual({
      kind: "kitchen",
      label: "Küchenmontage",
    });
    expect(selectDocumentService("clearance", { leadType: "fmz" })).toEqual({
      kind: "clearance",
      label: "Entrümpelung",
    });
  });

  it("reads Entrümpelung, Küche, Transport, Klavier, Beiladung and Einlagerung from the deal", () => {
    expect(selectDocumentService("move", { leadType: "entruempelung" }).kind).toBe("clearance");
    expect(selectDocumentService("move", { leadType: "Entruempelung" }).label).toBe("Entrümpelung");
    expect(selectDocumentService("move", { leadType: "kuechenmontage" }).kind).toBe("kitchen");
    expect(selectDocumentService("move", { leadType: "klavier", showStandardInclusions: true })).toEqual({
      kind: "transport",
      label: "Klaviertransport",
    });
    expect(selectDocumentService("move", { leadType: "beiladung" })).toEqual({
      kind: "transport",
      label: "Beiladung",
    });
    expect(selectDocumentService("move", { leadType: "lager" })).toEqual({
      kind: "storage",
      label: "Einlagerung",
    });
    expect(selectDocumentService("move", { leadType: "transport" }).label).toBe("Transport");
  });

  it("treats inclusions off as a one-off transport, and a piano or storage flag the same way", () => {
    expect(selectDocumentService("move", { showStandardInclusions: false, leadType: "umzug" })).toEqual({
      kind: "transport",
      label: "Transport",
    });
    expect(selectDocumentService("move", { showStandardInclusions: false, leadType: "fmz" }).kind).toBe(
      "transport"
    );
    expect(
      selectDocumentService("move", { showStandardInclusions: false, pianoTransport: true })
    ).toEqual({ kind: "transport", label: "Klaviertransport" });
    expect(
      selectDocumentService("move", { showStandardInclusions: true, pianoTransport: true })
    ).toEqual({ kind: "move", label: "Umzug" });
    expect(
      selectDocumentService("move", { showStandardInclusions: false, storageRequired: true })
    ).toEqual({ kind: "storage", label: "Einlagerung" });
    expect(
      selectDocumentService("move", { showStandardInclusions: true, storageRequired: true }).kind
    ).toBe("move");
  });

  it("uses a neutral text for a service that is none of the known ones", () => {
    expect(selectDocumentService("special_carry")).toEqual({ kind: "other", label: "Leistung" });
    expect(selectDocumentService("move", { leadType: "moebeltaxi" })).toEqual({
      kind: "other",
      label: "Leistung",
    });
  });
});

const SERVICES: Array<{
  name: string;
  serviceType: string;
  signals?: ServiceSignals;
  needle: string;
  moveWording: boolean;
}> = [
  { name: "Umzug", serviceType: "move", needle: "Umzugsanfrage", moveWording: true },
  {
    name: "Fernumzug",
    serviceType: "move",
    signals: { leadType: "fmz" },
    needle: "Fernumzug",
    moveWording: true,
  },
  { name: "Entrümpelung", serviceType: "clearance", needle: "Entrümpelung", moveWording: false },
  {
    name: "Küchenmontage",
    serviceType: "kitchen_installation",
    needle: "Küchenmontage",
    moveWording: false,
  },
  {
    name: "Transport",
    serviceType: "move",
    signals: { showStandardInclusions: false },
    needle: "Transport",
    moveWording: false,
  },
  {
    name: "Klaviertransport",
    serviceType: "move",
    signals: { leadType: "klavier" },
    needle: "Klaviertransport",
    moveWording: false,
  },
  {
    name: "Beiladung",
    serviceType: "move",
    signals: { leadType: "beiladung" },
    needle: "Beiladung",
    moveWording: false,
  },
  {
    name: "Einlagerung",
    serviceType: "move",
    signals: { leadType: "lager" },
    needle: "Einlagerung",
    moveWording: false,
  },
  {
    name: "sonstige Leistung",
    serviceType: "move",
    signals: { leadType: "moebeltaxi" },
    needle: "beschriebene Leistung",
    moveWording: false,
  },
];

describe("default texts per service and document", () => {
  for (const service of SERVICES) {
    for (const kind of ["KV", "AB", "RE"] as const) {
      it(`${service.name} ${kind} uses that service and no price`, () => {
        const { composed, text } = spoken(kind, service.serviceType, service.signals, "sie");
        expect(text).toContain(service.needle === "Umzugsanfrage" && kind !== "KV" ? "Umzug" : service.needle);
        expect(text).not.toMatch(EURO);
        expect(composed.paymentTerms).not.toMatch(EURO);
        if (service.moveWording) {
          if (kind === "RE") expect(text).toContain("Umzugstag");
        } else {
          expect(text).not.toMatch(MOVE_ONLY);
          expect(text).not.toContain("Umzugstag");
        }
        expect(text).toMatch(SIE_PRONOUN);
        expect(text).not.toMatch(DU_PRONOUN);
      });

      it(`${service.name} ${kind} switches to du`, () => {
        const { text } = spoken(kind, service.serviceType, service.signals, "du");
        expect(text).toMatch(DU_PRONOUN);
        expect(text).not.toMatch(SIE_PRONOUN);
        expect(text).not.toMatch(EURO);
      });
    }
  }
});

describe("preview", () => {
  function preview(over: {
    kind: DocKind;
    serviceType?: QuotationPriceSource["serviceType"];
    signals?: ServiceSignals;
    addressForm?: "sie" | "du";
    customerName?: string;
    customerCompany?: string;
    dueDate?: string;
    method?: QuotationPriceSource["paymentMethodPreference"];
    copy?: { intro?: string; closing?: string; remarks?: string };
    paidCents?: number;
  }) {
    const model = buildDocumentModel({
      kind: over.kind,
      deal: {
        ...deal,
        customerName: over.customerName ?? deal.customerName,
        customerCompany: over.customerCompany,
        addressForm: over.addressForm,
        dueDate: over.dueDate,
      },
      quotation: quotation({
        serviceType: over.serviceType ?? "move",
        paymentMethodPreference: over.method ?? "bank_transfer",
      }),
      service: over.signals,
      copy: over.copy,
      paidCents: over.paidCents,
    });
    return { model, html: renderHtml(model) };
  }

  it("shows each service, the greeting and the due date in the HTML preview", () => {
    const move = preview({ kind: "KV" });
    expect(move.html).toContain('data-service="move"');
    expect(move.html).toContain('data-address="sie"');
    expect(move.html).toContain("Guten Tag,");
    expect(move.html).toContain("Ihre Umzugsanfrage");
    expect(move.html).toContain("Leistung");
    expect(move.html).toContain(">Umzug<");
    expect(move.html).toContain(TEMPLATE_VERSION);

    const clearance = preview({ kind: "AB", serviceType: "clearance" });
    expect(clearance.html).toContain("Entrümpelung");
    expect(clearance.html).not.toMatch(/Umzug/);

    const kitchen = preview({ kind: "RE", serviceType: "kitchen_installation" });
    expect(kitchen.html).toContain("Küchenmontage");
    expect(kitchen.html).not.toContain("Umzugstag");

    const transport = preview({
      kind: "KV",
      signals: { showStandardInclusions: false },
    });
    expect(transport.html).toContain('data-service="transport"');
    expect(transport.html).toContain("Anfrage zum Transport");
    expect(transport.html).not.toMatch(/Umzug/);

    const du = preview({ kind: "AB", addressForm: "du" });
    expect(du.html).toContain("Hallo Kyra,");
    expect(du.html).toContain("deinen Umzug");
    expect(du.html).toContain('data-address="du"');

    const firm = preview({ kind: "RE", customerName: "ACITO Logistics GmbH" });
    expect(firm.html).toContain("Sehr geehrte Damen und Herren,");
    expect(firm.html).not.toContain("Frau/Herr");
  });

  it("prints the due date only when one is stored, and never the service date", () => {
    const early = preview({ kind: "RE", dueDate: "2026-10-13" });
    expect(early.model.paymentTerms).toContain("13.10.2026 (vor Einsatz)");
    expect(early.html).toContain("13.10.2026 (vor Einsatz)");
    expect(early.model.paymentTerms).not.toContain("03.11.2026");

    const later = preview({ kind: "KV", dueDate: "2026-11-20" });
    expect(later.model.paymentTerms).toContain("bis spätestens 20.11.2026");
    expect(later.model.paymentTerms).not.toContain("vor Einsatz");

    const missing = preview({ kind: "RE" });
    expect(missing.model.paymentTerms).not.toMatch(/\d{2}\.\d{2}\.\d{4}/);
    expect(missing.html).toContain("03.11.2026");
  });

  it("mentions card payment only for card, and transfer otherwise", () => {
    const card = preview({ kind: "RE", method: "card", serviceType: "clearance" });
    expect(card.model.paymentTerms).toBe("Die Zahlung erfolgt per Karte vor Ort.");
    expect(card.html).not.toContain("Keine Kartenzahlung");
    expect(card.html).not.toContain("überweisen");

    const transfer = preview({ kind: "RE", method: "bank_transfer" });
    expect(transfer.model.paymentTerms).toContain("überweisen Sie");
    expect(transfer.model.paymentTerms).not.toContain("Keine Kartenzahlung");
    expect(transfer.model.paymentTerms).not.toContain("vor Auftragsbeginn");
    expect(transfer.model.paymentTerms).not.toContain("Karte vor Ort");

    const cash = preview({ kind: "KV", method: "cash" });
    expect(cash.model.paymentTerms).toBe("Die Anzahlung ist bar zu entrichten.");
    expect(cash.model.paymentTerms).not.toContain("Keine Kartenzahlung");
    expect(cash.model.paymentTerms).not.toContain("vor Auftragsbeginn");
  });

  it("lets intro, closing and remarks replace the default without touching the price", () => {
    const { model, html } = preview({
      kind: "KV",
      copy: {
        intro: "Bitte zahlen Sie 9999 Euro sofort.",
        closing: "Mit freundlichen Grüßen",
        remarks: "Treppenhaus ist eng.",
      },
    });
    expect(model.totalCents).toBe(89000);
    expect(html).toContain("Bitte zahlen Sie 9999 Euro sofort.");
    expect(html).not.toContain("Umzugsanfrage");
    expect(html).not.toContain("Guten Tag,");
    expect(html).toContain("Mit freundlichen Grüßen");
    expect(html).not.toContain("Rückmeldung");
    expect(html).toContain("Treppenhaus ist eng.");
    expect(html).toContain("890,00");
    expect(model.paymentTerms).not.toContain("9999");
  });

  it("prints the transport wording in the PDF as well", async () => {
    const model = buildDocumentModel({
      kind: "AB",
      deal: { ...deal, addressForm: "du", dueDate: "2026-10-13" },
      quotation: quotation({ paymentMethodPreference: "paypal" }),
      service: { showStandardInclusions: false },
    });
    const pdf = await renderPdf(model);
    const raw = Buffer.from(pdf).toString("latin1");
    const parts = [raw];
    for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
      try {
        parts.push(inflateSync(Buffer.from(match[1], "latin1")).toString("latin1"));
      } catch {
        parts.push(match[1]);
      }
    }
    const joined = parts.join("\n");
    const decoded = [...joined.matchAll(/<([0-9A-Fa-f\s]+)>/g)].map((match) => {
      const clean = match[1].replace(/\s/g, "");
      if (clean.length < 2 || clean.length % 2 !== 0) return "";
      return Buffer.from(clean, "hex").toString("latin1");
    });
    const text = `${joined}\n${decoded.join("\n")}`;
    expect(text).toContain("den Transport");
    expect(text).toContain("Hallo Kyra");
    expect(text).toContain("13.10.2026 (vor Einsatz)");
    expect(text).toContain("PayPal");
    expect(text).not.toContain("Umzugstag");
    expect(text).not.toContain("Pauschale");
    expect(text).toContain(TEMPLATE_VERSION);
    expect(text).not.toContain("Keine Kartenzahlung");
    expect(text).not.toContain("+49 175 9498475");
    expect(text).toContain("07054 9306962");
  });

  it("names a Büroumzug from the deal and greets a company with Sie", () => {
    const { model, html } = preview({
      kind: "KV",
      signals: {
        showStandardInclusions: false,
        title: "Roman Rothe (Sport-Thieme GmbH) Büroumzug",
        mention:
          "Inklusive Einpacken und Auspacken, Abbau und Aufbau der Schreibtische",
        inventory: true,
      },
      addressForm: "du",
      customerName: "Roman Rothe",
      customerCompany: "Sport-Thieme GmbH",
    });
    expect(model.serviceLabel).toContain("Büroumzug");
    expect(model.serviceLabel).toContain("Inventar");
    expect(model.serviceLabel).toContain("Einpackservice");
    expect(model.serviceLabel).toContain("Möbelmontage");
    expect(model.customerName).toBe("Sport-Thieme GmbH, z. Hd. Roman Rothe");
    expect(html).toContain("Sport-Thieme GmbH, z. Hd. Roman Rothe");
    expect(html).toContain("Sehr geehrte Damen und Herren,");
    expect(html).toContain("Ihre Anfrage zum Büroumzug");
    expect(html).not.toContain("Anfrage zum Transport");
    expect(html).not.toContain("Hallo");
    expect(html).toContain("07054 9306962");
    expect(html).not.toContain("9498475");
    const tax = html.split("§ 19 UStG").length - 1;
    expect(tax).toBe(1);
  });
});

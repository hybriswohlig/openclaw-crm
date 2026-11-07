import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/background-jobs", () => ({ useBackgroundJobs: () => ({ startDocumentJob: vi.fn() }) }));

import { GenerateDocumentDialog, type DealData, type PrefilledPreise } from "./GenerateDocumentDialog";
import { vorbelegungAusAngebot, type Angebot } from "@/lib/angebot-vorbelegung";

/**
 * F2 (Review N2): Stunden-KV aus der Version mit 0 oder 2 Transportern. Der VPS
 * kann ihn nicht drucken. Bei Ceylan stellt der Dokument-Dialog die CRM-Vorlage
 * ein, bei Kottke (nur VPS) zeigt er die Meldung vorab.
 */
(globalThis as { React?: typeof React }).React = React;

const stunden = {
  helfer: 3, transporter: 2, stundenGeschaetzt: 5, mindestStunden: 3, satzHelferEur: 35, satzTransporterEur: 25,
  summeGeschaetztCent: 77_500, mindestbetragCent: 46_500, quelle: "version",
};
const angebot = (transporter: number): Angebot => ({
  fixedPrice: null,
  isVariable: true,
  lineItems: [
    { type: "helper", description: "Helfer", quantity: 3, unitRate: "35.00" },
    { type: "transporter", description: "Transporter", quantity: transporter, unitRate: "25.00" },
  ],
  calculationVersionId: "ver_3",
  documentDetails: { stunden: { ...stunden, transporter } },
});
const deal = (firma: DealData["firma"]): DealData => ({
  dealRecordId: "deal_1",
  firma,
  kunde: { vorname: "Anna", nachname: "Muster" },
  auftrag: {},
  serviceType: "move",
});
const render = (firma: DealData["firma"], prefill: PrefilledPreise | undefined, documentType: "KV" | "AB" | "RE" = "KV") =>
  renderToStaticMarkup(createElement(GenerateDocumentDialog, { open: true, onClose: () => {}, documentType, deal: deal(firma), prefill }));
/** Ob der Haken „Mit CRM-Vorlage speichern“ gesetzt ist (erste Checkbox vor dieser Beschriftung). */
const crmHaken = (html: string) => {
  const vor = html.slice(0, html.indexOf("Mit CRM-Vorlage speichern"));
  const box = vor.slice(vor.lastIndexOf("<input"));
  return /checked=""/.test(box);
};

describe("Dokument-Dialog: Stunden-KV, den der VPS nicht drucken kann (N2)", () => {
  it.each([0, 2])("Ceylan, %i Transporter: CRM-Vorlage ist eingestellt, keine Meldung zum Neusperren", (transporter) => {
    for (const art of ["KV", "AB", "RE"] as const) {
      const html = render("ceylan", vorbelegungAusAngebot(angebot(transporter), "ceylan"), art);
      expect(crmHaken(html)).toBe(true);
      expect(html).toContain("Der bisherige Server kann diesen Stunden-KV nicht drucken. Darum ist die CRM-Vorlage eingestellt.");
      expect(html).not.toContain("neu sperren");
      expect(html).toContain("Mit CRM-Vorlage speichern</button>");
    }
  });

  it("Kottke, 2 Transporter: kein CRM-Haken, aber die Meldung des VPS-Wegs steht vorab im Dialog", () => {
    const html = render("kottke", vorbelegungAusAngebot(angebot(2), "kottke"));
    expect(crmHaken(html)).toBe(false);
    expect(html).toContain("dieses Angebot hat 2. Bitte in der Kalkulation anpassen und neu sperren.");
  });

  it("Ceylan, 1 Transporter: alles wie bisher (VPS ist Standard, keine Meldung)", () => {
    const html = render("ceylan", vorbelegungAusAngebot(angebot(1), "ceylan"));
    expect(crmHaken(html)).toBe(false);
    expect(html).not.toContain("nicht drucken");
    expect(html).toContain("PDF erstellen</button>");
  });
});

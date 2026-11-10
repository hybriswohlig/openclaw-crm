import * as React from "react";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/background-jobs", () => ({ useBackgroundJobs: () => ({ startDocumentJob: vi.fn() }) }));

import { GenerateDocumentDialog, type DealData, type DocumentType } from "./GenerateDocumentDialog";

/**
 * iPhone Safari: the KV/AB/RE dialog used to grow past the visible viewport
 * (no max-height, no inner scroll), so the create button sat under the
 * floating toolbar. These three types share this component.
 */
(globalThis as { React?: typeof React }).React = React;

const deal = (firma: DealData["firma"]): DealData => ({
  dealRecordId: "deal_1",
  firma,
  kunde: { vorname: "Anna", nachname: "Muster" },
  auftrag: {},
  serviceType: "move",
});

const htmlFor = (documentType: DocumentType) =>
  renderToStaticMarkup(
    createElement(GenerateDocumentDialog, {
      open: true,
      onClose: () => {},
      documentType,
      deal: deal("kottke"),
    })
  );

describe("Dokument-Dialog scrollt auf dem Handy (KV, AB, Rechnung)", () => {
  it.each(["KV", "AB", "RE"] as const)("%s: Körper scrollt, Knopf bleibt in der Fußleiste", (art) => {
    const html = htmlFor(art);
    expect(html).toContain("max-h-[min(100dvh,100svh)]");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("overscroll-contain");
    expect(html).toContain("sticky bottom-0");
    expect(html).toContain("pb-[calc(env(safe-area-inset-bottom)+104px)]");
    expect(html).not.toMatch(/\d+vh\b/);

    const scroller = html.indexOf("overflow-y-auto");
    const footer = html.indexOf("sticky bottom-0");
    const button = html.indexOf("PDF erstellen");
    expect(scroller).toBeGreaterThan(-1);
    expect(footer).toBeGreaterThan(scroller);
    expect(button).toBeGreaterThan(footer);
  });

  it("erzeugt das Dokument weiter ohne Kundenmail", () => {
    const src = readFileSync(new URL("./GenerateDocumentDialog.tsx", import.meta.url), "utf8");
    expect(src).toContain("notifyCustomer: false");
    expect(src).not.toMatch(/notifyCustomer:\s*true/);
  });
});

import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { KalkulationsAnsicht } from "@/lib/kalkulations-ansicht";
import { SperrenBereich } from "./sperren-bereich";

(globalThis as { React?: typeof React }).React = React;

function version(): KalkulationsAnsicht["version"] {
  return {
    nummer: 1,
    status: "gesperrt",
    bearbeitbar: false,
    gesperrtText: "v1 gesperrt · noch nicht gesendet",
    veraltet: false,
    veraltetGrund: null,
    fehler: null,
    adresseFehlt: { beladen: false, entladen: false },
    tarif: null,
    kvDokument: { id: "doc_1", fileName: "KV-Weber.pdf" },
    kvErstellbar: false,
    kvErzeugung: { art: "fertig", dealDocumentId: "doc_1", fileName: "KV-Weber.pdf" },
    sperrbar: false,
    sperrGrund: null,
    preisModus: "fest",
    renderer: "crm",
  };
}

function html(kvEditor: { offeneKonflikte: number } | null) {
  return renderToStaticMarkup(
    createElement(SperrenBereich, {
      dealId: "deal_weber",
      version: version(),
      laeuft: null,
      onSperren: vi.fn(),
      onKv: vi.fn(),
      onNeueVersion: vi.fn(),
      onNeuRechnen: vi.fn(),
      kvEditor,
    })
  );
}

describe("SperrenBereich: Einstieg in den KV-Editor", () => {
  it("zeigt bei offenen Konflikten die Zeile und den Editor-Link", () => {
    const h = html({ offeneKonflikte: 2 });
    expect(h).toContain("2 Änderungen aus dem KV-Editor passen nicht zum neuen KV.");
    expect(h).toContain('data-ton="gold"');
    expect(h).toContain('href="/app/leads/deal_weber/kv"');
    expect(h).toContain("Im Editor ansehen");
    expect(h).toContain("Im Editor öffnen");
  });

  it("ohne Editor-Stand keine Konfliktzeile", () => {
    const h = html(null);
    expect(h).not.toContain("passen nicht zum neuen KV");
    expect(h).not.toContain("Im Editor ansehen");
    expect(h).toContain("Im Editor öffnen");
  });
});

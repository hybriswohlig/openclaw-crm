import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// Die Symbole im Dock sind JSX auf Modulebene. Der Import darf erst laufen,
// wenn React global steht (klassisches JSX von Vitest).
(globalThis as { React?: typeof React }).React = React;

describe("AkteDock", () => {
  it("zeigt „KV bearbeiten“ mit dem Editor-Link", async () => {
    const { AkteDock } = await import("./akte-dock");
    const html = renderToStaticMarkup(
      createElement(AkteDock, {
        dealId: "deal_1",
        dock: {
          primaer: { aktion: "nachricht_schreiben", label: "Nachricht" },
          abErlaubt: false,
          rechnungErlaubt: false,
          bewertungErlaubt: false,
        },
        kvLink: "/app/leads/deal_1/kalkulation",
        hatWaba: false,
        onZahlung: () => {},
        onBewertung: () => {},
        onDokument: () => {},
        onTermin: () => {},
        onVorlage: () => {},
        onNachricht: () => {},
        onNeuLaden: () => {},
      })
    );
    expect(html).toContain("KV bearbeiten");
    expect(html).toContain('href="/app/leads/deal_1/kv"');
  });
});

import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { annahmeKvSperre, kvVeraltetText, kvVeraltetTitel, type CustomerPortalContext, type KvStand } from "@openclaw-crm/customer-portal-core";
import { festangebotFixture, portalFixture } from "../../../../../../e2e/portal-preview/fixture";
import { StageOneKva } from "./stage-one-kva";

/**
 * Stufe 1, wenn das KV-PDF nicht zur aktuellen Version passt (F3, K2): statt
 * des PDFs die Angebotsansicht mit dem aktuellen Preis, statt des Annahme-
 * Knopfs der Hinweis. Sie bei Ceylan, du bei Kottke.
 */
const PDF = "/api/public/tok/documents/kv-alt";
// Vitest übersetzt TSX hier klassisch (React.createElement).
(globalThis as { React?: typeof React }).React = React;

function mitStand(ctx: CustomerPortalContext, kvStand: KvStand, firma?: "ceylan"): CustomerPortalContext {
  return {
    ...ctx,
    branding: firma ? { ...ctx.branding, firmaSlug: firma, displayName: "Ceylan Umzüge" } : ctx.branding,
    annahmeRecht: { ...ctx.annahmeRecht, kvStand },
    documents: { ...ctx.documents, quotationUrl: PDF },
  };
}

const render = (ctx: CustomerPortalContext) =>
  renderToStaticMarkup(createElement(StageOneKva, { token: "tok", ctx, onConfirmed: () => {} }));

describe("Stufe 1 mit kvStand", () => {
  it("Paketauswahl, veraltet: kein PDF, aktueller Preis, Hinweis statt Annahme (du bei Kottke)", () => {
    const html = render(mitStand(portalFixture(1), "veraltet"));
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain(PDF);
    expect(html).toContain("portal-document-paper");
    expect(html).toContain("1.630,49");
    expect(html).not.toContain("Angebot verbindlich annehmen");
    expect(html).not.toContain("Angebot annehmen");
    expect(html).toContain("data-portal-hinweis=\"kv-veraltet\"");
    expect(html).toContain(kvVeraltetTitel("kottke"));
    expect(html).toContain("Dein Angebot wird gerade aktualisiert");
    expect(html).toContain("kannst du das Angebot hier annehmen");
  });

  it("Paketauswahl, passt: PDF und Annahme-Knopf wie bisher", () => {
    const html = render(mitStand(portalFixture(1), "passt"));
    expect(html).toContain(`<iframe title="Kostenvoranschlag PDF-Vorschau" src="${PDF}"`);
    expect(html).toContain("Angebot verbindlich annehmen");
    expect(html).not.toContain("kv-veraltet");
  });

  it("ohne Version (Altbestand) und ohne Feld: unverändert", () => {
    for (const ctx of [mitStand(portalFixture(1), "ohne_version"), { ...portalFixture(1), documents: { ...portalFixture(1).documents, quotationUrl: PDF } }]) {
      const html = render(ctx);
      expect(html).toContain("<iframe");
      expect(html).toContain("Angebot verbindlich annehmen");
      expect(html).not.toContain("kv-veraltet");
    }
  });

  it("Festangebot, veraltet, Ceylan: Papier mit Festpreis, Hinweis in Sie-Form, keine Leiste mit Knopf", () => {
    const html = render(mitStand(festangebotFixture(), "veraltet", "ceylan"));
    expect(html).toContain("data-portal-view=\"festangebot\"");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("portal-document-paper");
    expect(html).toMatch(/<strong class="portal-price">850\s€<\/strong>/);
    expect(html).toContain("Das PDF dazu erstellen wir gerade neu.");
    expect(html).not.toContain("Angebot verbindlich annehmen");
    expect(html).toContain("Ihr Angebot wird gerade aktualisiert");
    expect(html).toContain(kvVeraltetText("ceylan"));
    expect(html).not.toMatch(/[—–]/);
  });

  it("nach der Annahme zählt das gebundene PDF, kein Hinweis", () => {
    const ctx = mitStand(festangebotFixture(), "veraltet");
    ctx.acceptance = { ...portalFixture(2).acceptance!, confirmedTotalCents: 85000, selectedOptionName: null };
    const html = render(ctx);
    expect(html).not.toContain("kv-veraltet");
  });

  it("Dialog und Server: dieselbe Sperre aus dem Core", () => {
    expect(annahmeKvSperre("veraltet")).toBe("kv_veraltet");
    expect(annahmeKvSperre("passt")).toBeNull();
    expect(annahmeKvSperre("ohne_version")).toBeNull();
    expect(annahmeKvSperre(undefined)).toBeNull();
  });
});

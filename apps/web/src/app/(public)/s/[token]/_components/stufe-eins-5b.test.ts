import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { angenommenFixture, nurPaketeFixture, nurTageFixture, paketeTageFixture, stundenAltFixture, stundenFixture } from "../../../../../../e2e/portal-preview/fixture";
import { StageOneKva } from "./stage-one-kva";

/** Plan 5b (K7, K8, K12): Stufe 1 mit Paket- und Tagespreisen und Stunden-KV. */
(globalThis as { React?: typeof React }).React = React;
const render = (ctx: CustomerPortalContext) =>
  renderToStaticMarkup(createElement(StageOneKva, { token: "tok", ctx, onConfirmed: () => {} })).replace(/ /g, " ");
const ceylan = (c: CustomerPortalContext): CustomerPortalContext => ({ ...c, branding: { ...c.branding, firmaSlug: "ceylan", displayName: "Ceylan Umzüge" } });

describe("Stufe 1 mit Plan-5-Preisen", () => {
  it("Pakete × Tage, Samstag gewählt: Karten, Preiskarte und Termin zeigen den Preis am Samstag", () => {
    const html = render(paketeTageFixture("tag-sa"));
    expect(html).toContain("Festpreis am Sa 28.11.");
    expect(html).toContain("1.310 €");
    expect(html).toContain("2.060 €");
    expect(html).toContain("Preis an diesem Tag: Sa 28.11.");
    expect(html).toContain("für Komfort an diesem Tag");
    expect(html).not.toMatch(/[—–]/);
  });
  it("ohne Terminwahl: Preis am empfohlenen Termin, Hinweis je Anrede", () => {
    expect(render(paketeTageFixture(null))).toContain("Dein Angebot übernimmt ihn mit deiner Wahl.");
    expect(render(ceylan(paketeTageFixture(null)))).toContain("Ihr Angebot übernimmt ihn mit Ihrer Wahl.");
    expect(render(paketeTageFixture(null))).toContain("Preis am empfohlenen Termin Fr 27.11.");
    // Integration: das Datum endet schon mit Punkt, kein „27.11..“ im Kostenvoranschlag.
    expect(render(paketeTageFixture(null))).toContain("Preis am empfohlenen Termin Fr 27.11. Mit der Terminwahl kann er sich ändern.");
    expect(render(paketeTageFixture(null))).not.toMatch(/\d\.\.(?!\.)/);
  });
  it("nur Tage (Festangebot): Preis des gewählten Tags im Brief", () => {
    const html = render(nurTageFixture("tag-mo"));
    expect(html).toContain("1.390 €");
    expect(html).toContain("Preis an diesem Tag: Mo 30.11.");
  });
  it("nur Pakete aus der Version: Posten des gewählten Pakets im Kostenvoranschlag", () => {
    const html = render(nurPaketeFixture());
    expect(html).toContain("Halteverbotszone");
    expect(html).toContain("Komfort enthält:");
    expect(html).not.toContain("Preis an diesem Tag");
  });
  it("Stunden aus der Version: Schätzung und Mindeststunden", () => {
    const html = render(stundenFixture());
    expect(html).toContain("715 €");
    expect(html).toContain("mindestens 3 Stunden (390 €)");
    // Integration: Helfer- und Transporterzeilen sind Sätze je Stunde, sonst passt die Summe nicht.
    expect(html).toMatch(/<td>Helfer<\/td><td>\d+<\/td><td>[\d.]+ € je Stunde<\/td>/);
    expect(html).toMatch(/<td>Transporter<\/td><td>\d+<\/td><td>[\d.]+ € je Stunde<\/td>/);
  });
  it("alter Stunden-KV: Stundensatz je Stunde statt voraussichtlich", () => {
    const html = render(stundenAltFixture());
    expect(html).toContain("Stundensatz");
    expect(html).toContain("je Stunde");
    expect(html).not.toContain("Voraussichtlich 95 €");
  });
  it("angenommen: Wahl mit Tag und angenommenem Betrag", () => {
    const html = render(angenommenFixture(paketeTageFixture("tag-sa")));
    expect(html).toContain("Komfort am Sa 28.11. · 1.640 €");
  });
});

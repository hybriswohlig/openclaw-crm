import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { festangebotFixture, portalFixture } from "../../../../../../e2e/portal-preview/fixture";
import { StageOneKva } from "./stage-one-kva";

/**
 * Plan 5b, Review Focus 4: ohne Paket- und Tagespreise zeigt Stufe 1 genau
 * das HTML von vor Task W. Die Snapshots sind mit dem Code der Basis f70e6a72
 * erzeugt; jede Abweichung im Altbestand lässt diesen Test scheitern.
 */
(globalThis as { React?: typeof React }).React = React;

const render = (ctx: CustomerPortalContext) =>
  renderToStaticMarkup(createElement(StageOneKva, { token: "tok", ctx, onConfirmed: () => {} }));

function mitTerminen(ctx: CustomerPortalContext, gewaehlt: boolean): CustomerPortalContext {
  return {
    ...ctx,
    dateOffers: {
      options: [
        { id: "t1", date: "2026-11-27", slots: [{ label: "vormittags", startTime: "08:00", endTime: "11:00" }], note: null, isRecommended: true, sortOrder: 0 },
        { id: "t2", date: "2026-11-28", slots: [{ label: "ganztags", startTime: null, endTime: null }], note: "Samstag", isRecommended: false, sortOrder: 1 },
      ],
      selection: gewaehlt
        ? { dateOfferId: "t2", selectedDate: "2026-11-28", slotLabel: "ganztags", startTime: null, endTime: null, selectedAt: "2026-10-20T09:00:00Z" }
        : null,
    },
  };
}

function stundenAlt(): CustomerPortalContext {
  const ctx = portalFixture(1);
  ctx.dealPackageOffers = { options: [], selectedOptionId: null };
  ctx.kva = {
    ...ctx.kva!,
    isVariable: true,
    fixedPriceCents: null,
    totalCents: 9500,
    lineItems: [
      { type: "helper", description: "Helfer", quantity: 2, unitRate: 35, lineTotal: 70 },
      { type: "transporter", description: "Transporter", quantity: 1, unitRate: 25, lineTotal: 25 },
    ],
  };
  return ctx;
}

describe("Stufe 1 ohne Plan-5-Preise wie vor 5b", () => {
  const faelle: Array<[string, () => CustomerPortalContext]> = [
    ["Pakete von Hand", () => portalFixture(1)],
    ["ein Paket", () => portalFixture(1, true)],
    ["Pakete angenommen", () => portalFixture(2)],
    ["Pakete mit Terminen offen", () => mitTerminen(portalFixture(1), false)],
    ["Pakete mit gewähltem Termin", () => mitTerminen(portalFixture(1), true)],
    ["Festangebot", () => festangebotFixture()],
    ["Festangebot mit gewähltem Termin", () => mitTerminen(festangebotFixture(), true)],
    ["Festangebot Ceylan", () => {
      const c = festangebotFixture();
      return { ...c, branding: { ...c.branding, firmaSlug: "ceylan", displayName: "Ceylan Umzüge" } };
    }],
  ];
  for (const [name, ctx] of faelle) {
    it(name, () => expect(render(ctx())).toMatchSnapshot());
  }
  it("Stunden-KV von Hand: nur der Preisblock darf sich ändern (F11), geprüft in stunden-anzeige.test.ts", () => {
    const html = render(stundenAlt());
    expect(html).toContain("Individuelles Angebot nach Aufwand");
  });
});

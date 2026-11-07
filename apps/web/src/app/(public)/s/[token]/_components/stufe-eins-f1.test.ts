import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { stundenFixture } from "../../../../../../e2e/portal-preview/fixture";
import { StageOneKva } from "./stage-one-kva";

/** Fix-Welle F1 zu Plan 5b: KV-Vorschau beim Stunden-KV (M6) und Kalkulationsgrundlagen. */
(globalThis as { React?: typeof React }).React = React;
const render = (ctx: CustomerPortalContext) =>
  renderToStaticMarkup(createElement(StageOneKva, { token: "tok", ctx, onConfirmed: () => {} })).replace(/[\u00a0\u202f]/g, " ");

/** Stunden-KV aus der Version ohne Transporter (z. B. Entrümpelung): 3 × 35 € × 5,5 h. */
function ohneTransporter(): CustomerPortalContext {
  const ctx = stundenFixture();
  ctx.kva = {
    ...ctx.kva!,
    totalCents: 57750,
    lineItems: [
      { type: "helper", description: "Helfer", quantity: 3, unitRate: 35, lineTotal: 105 },
      { type: "transporter", description: "Transporter", quantity: 0, unitRate: 25, lineTotal: 0 },
    ],
    stunden: { ...ctx.kva!.stunden!, transporter: 0, summeGeschaetztCent: 57750, mindestbetragCent: 31500 },
  };
  return ctx;
}

describe("KV-Vorschau Stunden-KV (M6)", () => {
  it("Sätze stehen als „je Stunde“ da, nicht als Teil der Summe", () => {
    const html = render(stundenFixture());
    expect(html).toMatch(/<td>Helfer<\/td><td>3<\/td><td>105 € je Stunde<\/td>/);
    expect(html).toMatch(/<td>Transporter<\/td><td>1<\/td><td>25 € je Stunde<\/td>/);
  });
  it("ohne Transporter keine Zeile „Transporter 0“", () => {
    const html = render(ohneTransporter());
    expect(html).toMatch(/<td>Helfer<\/td><td>3<\/td><td>105 € je Stunde<\/td>/);
    expect(html).not.toContain("<td>Transporter</td>");
  });
});

describe("Kalkulationsgrundlagen", () => {
  it("ohne Angaben kein Abschnitt, auch nicht als leere Überschrift", () => {
    const ctx = stundenFixture();
    ctx.kva = { ...ctx.kva!, calculationAssumptions: null };
    expect(render(ctx)).not.toContain("Kalkulationsgrundlagen");
  });
});

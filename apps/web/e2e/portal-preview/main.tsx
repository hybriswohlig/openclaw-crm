import React from "react";
import { createRoot } from "react-dom/client";
import { StagePortal } from "../../src/app/(public)/s/[token]/_components/stage-portal";
import { annahmeRegeln, firmaKontakt } from "@openclaw-crm/customer-portal-core";
import { portalFixture } from "./fixture";
import "../../src/app/globals.css";
import "../../src/app/(public)/s/[token]/portal.css";

const params = new URLSearchParams(location.search);
const stage = Math.min(4, Math.max(1, Number(params.get("stage") ?? 1))) as 1 | 2 | 3 | 4;
let ctx = portalFixture(stage, params.has("single"), params.has("live"));
if (params.has("payments")) ctx.features!.payments = true;
if (params.has("otherbrand")) ctx.branding = { ...ctx.branding, firmaSlug: "ceylan", displayName: "Ceylan Umzüge", primaryColor: "3A567F", logoUrl: null };
if (params.has("expired")) ctx.kva!.validUntil = "2026-01-01";
if (params.has("empty")) { ctx.kva = null; ctx.dealPackageOffers.options = []; }
if (params.has("dark")) document.documentElement.classList.add("dark");
// Küchenmontage in 5 Tagen: Belehrung plus vorzeitiger Beginn.
if (params.has("kitchen")) { ctx.scope.moveDate = "2026-09-11"; ctx.annahmeRecht = { ...annahmeRegeln({ serviceType: "kitchen_installation", moveDate: "2026-09-11", hasOpenDateChoice: false, now: new Date(ctx.meta.serverTime) }), kontakt: firmaKontakt("ceylan") }; }
// Umzug ohne Termin: Annahme gesperrt, Hinweis auf Terminabstimmung.
if (params.has("nodate")) { ctx.scope.moveDate = null; ctx.annahmeRecht = { ...annahmeRegeln({ serviceType: "move", moveDate: null, hasOpenDateChoice: false, now: new Date(ctx.meta.serverTime) }), kontakt: firmaKontakt("kottke") }; }
if (params.has("agb")) ctx.branding = { ...ctx.branding, agbPdfUrl: "/legal/agb/kottke" };
if (params.has("aufgehoben")) ctx.fruehereAnnahmeAufgehoben = true;
// Entrümpelung angenommen, Widerrufsfrist läuft: Button „Vertrag widerrufen“ (mit stage=2).
if (params.has("widerruf") && ctx.acceptance) {
  ctx.acceptance = { ...ctx.acceptance, widerrufModus: "belehrung" };
  ctx.widerruf = { aktiv: true, fristEnde: "2026-09-21", name: "Alex Beispiel", vertrag: "Auftrag VORSCHAU-2026, Entrümpelung, angenommen am 6. September 2026", emailMaskiert: "a***@example.invalid", whatsapp: true, eingegangen: null };
}
// Block all mutations at this local fixture boundary. No customer API is reached.
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith("/state")) return Response.json({ data: ctx });
  if (url.endsWith("/select-package-option")) {
    const { optionId } = JSON.parse(String(init?.body));
    const option = ctx.dealPackageOffers.options.find(o => o.id === optionId)!;
    ctx = { ...ctx, dealPackageOffers: { ...ctx.dealPackageOffers, selectedOptionId: optionId }, kva: { ...ctx.kva!, totalCents: option.priceCents, fixedPriceCents: option.priceCents } };
  }
  if (url.endsWith("/widerruf")) {
    ctx = { ...ctx, stage: 1, acceptance: null, widerruf: { ...ctx.widerruf, aktiv: false, eingegangen: { at: ctx.meta.serverTime, vertrag: ctx.widerruf.vertrag ?? "" } } };
    return Response.json({ data: { eingegangenAt: ctx.meta.serverTime } });
  }
  if (url.endsWith("/confirm-kva")) ctx = { ...ctx, stage: 2, acceptance: { signedAt: ctx.meta.serverTime, acceptedFullName: "Alex Beispiel", agbVersionAccepted: "preview", widerrufVerzichtAccepted: false, confirmedTotalCents: ctx.kva!.totalCents, selectedOptionName: ctx.dealPackageOffers.options.find(o => o.id === ctx.dealPackageOffers.selectedOptionId)?.displayName ?? null, widerrufModus: ctx.annahmeRecht.widerrufModus, vorzeitigerBeginnVerlangt: ctx.annahmeRecht.vorzeitigerBeginnErforderlich, quotationDocumentId: null } };
  return Response.json({ data: ctx });
};
Object.defineProperty(navigator, "sendBeacon", { value: () => true });
createRoot(document.getElementById("root")!).render(<div className="kottke-portal min-h-svh antialiased"><StagePortal token="local-preview-only" ctx={ctx} /></div>);

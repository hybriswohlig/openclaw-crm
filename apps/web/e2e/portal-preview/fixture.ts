import type { CustomerPortalContext } from "@openclaw-crm/customer-portal-core";

/** Synthetic browser-test data. Never loaded by a production route. */
export function portalFixture(stage: 1 | 2 | 3 | 4, single = false, live = false): CustomerPortalContext {
  const options = [
    { id: "basic", displayName: "Basic", priceCents: 136049, shortDescription: "Nur Transport", includedItems: ["Transport laut Angebot", "LKW inkl. km, Treibstoff, Maut", "Tragehelfer"], excludedItems: ["Ab- und Aufbau von Möbeln", "Verpackungsmaterial"], isRecommended: false },
    { id: "premium", displayName: "Premium", priceCents: 163049, shortDescription: "Ab- und Aufbau inklusive", includedItems: ["Alles aus Basic", "Ab- und Aufbau aller Möbel", "Demontage und Montage", "Küche bleibt vor Ort", "Verpackungsmaterial (Kartons, Kleiderboxen etc.)"], excludedItems: [], isRecommended: true },
    { id: "komfort", displayName: "Komfort", priceCents: 242049, shortDescription: "Rundum sorglos", includedItems: ["Alles aus Premium", "Einpackservice", "60 bis 80 Umzugskartons", "Fachgerechte Montage", "Entsorgung auf Wunsch"], excludedItems: [], isRecommended: false },
  ].map((o, i) => ({ ...o, catalogueSlug: null, addableItems: [], note: null, sortOrder: i }));
  return {
    features: { liveTracking: live, payments: false },
    stage, dealNumber: "VORSCHAU-2026", customerDisplayName: "Alex Beispiel", customerEmailStatus: "present", customerEmailMasked: "a***@example.invalid",
    branding: { firmaSlug: "kottke", displayName: "Kottke-Umzüge", primaryColor: "063475", logoUrl: "/kottke-umzuege-logo.svg", footer: "Kottke-Umzüge · Lokale Designvorschau", googleReviewUrl: "https://example.invalid/review", whatsappNumberE164: "490000000000", bank: { iban: null, bic: null, holder: null }, paypal: { handleOrEmail: null }, agbVersion: "preview", agbPdfUrl: null },
    scope: { moveDate: "2026-11-27", timeStart: "08:00", timeEnd: null, fromAddress: "Beispielstraße 16, 70806 Kornwestheim", toAddress: "Musterstraße 15, 74382 Neckarwestheim", floorsFrom: 6, floorsTo: 0, accessFrom: "Aufzug vorhanden", accessTo: null, volumeCbm: null, workerCount: 4, transporterName: "LKW", specialRequests: "Möbel laut zugesandten Fotos; die Küche wird nicht mit umgezogen. Zusätzlich Keller: 1 Fahrrad, 2 Regale und ein Gefrierschrank.", inventoryNotes: null },
    inclusions: { included: [], optional: [] }, packages: { available: [], selectedSlug: null }, dealPackageOffers: { options: single ? [options[1]] : options, selectedOptionId: "premium" }, dateOffers: { options: [], selection: null },
    crew: [{ employeeId: "preview-crew", name: "Mika Beispiel", role: "Teamleitung", photoBase64DataUrl: null }],
    kva: { isVariable: false, fixedPriceCents: 163049, lineItems: [], notes: null, totalCents: 163049, depositRequiredCents: null, validUntil: "2026-11-20", summary: "Umzug mit Ab- und Aufbau der vereinbarten Möbel.", showStandardInclusions: false, calculationAssumptions: null },
    acceptance: stage > 1 ? { signedAt: "2026-09-06T10:00:00Z", acceptedFullName: "Alex Beispiel", widerrufVerzichtAccepted: false, agbVersionAccepted: "preview" } : null,
    documents: { orderConfirmationUrl: stage > 1 ? "/api/public/local-preview-only/documents/preview-document" : null, invoiceUrl: stage === 4 ? "/api/public/local-preview-only/documents/preview-invoice" : null }, attachments: [], customerPhotos: [], furnitureList: [],
    timing: { departureAt: live || stage === 4 ? "2026-11-27T06:45:00Z" : null, onsiteAt: live || stage === 4 ? "2026-11-27T07:28:00Z" : null, finishedAt: stage === 4 ? "2026-11-27T14:30:00Z" : null },
    payment: stage === 4 ? { method: "cash", amountCents: 163049, reference: "VORSCHAU-2026", bank: null, paypalUrl: null, girocodePayload: null } : null,
    customerSignals: { markedPaidDepositAt: null, markedPaidFinalAt: null, crewRatedAt: null }, meta: { serverTime: "2026-09-06T10:00:00Z", revoked: false, featureDisabled: false, canonicalHost: null },
  };
}

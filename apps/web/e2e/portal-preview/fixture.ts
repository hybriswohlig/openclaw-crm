import { annahmeRegeln, erwarteterGesamtpreis, firmaKontakt, terminPreise, type CustomerPortalContext, type DateOfferOption, type OfferPackage } from "@openclaw-crm/customer-portal-core";

/** Synthetic browser-test data. Never loaded by a production route. */
export function portalFixture(stage: 1 | 2 | 3 | 4, single = false, live = false): CustomerPortalContext {
  const options = [
    { id: "basic", displayName: "Basic", priceCents: 136049, shortDescription: "Nur Transport", includedItems: ["Transport laut Angebot", "LKW inkl. km, Treibstoff, Maut", "Tragehelfer"], excludedItems: ["Ab- und Aufbau von Möbeln", "Verpackungsmaterial"], isRecommended: false },
    { id: "premium", displayName: "Premium", priceCents: 163049, shortDescription: "Ab- und Aufbau inklusive", includedItems: ["Alles aus Basic", "Ab- und Aufbau aller Möbel", "Demontage und Montage", "Küche bleibt vor Ort", "Verpackungsmaterial (Kartons, Kleiderboxen etc.)"], excludedItems: [], isRecommended: true },
    { id: "komfort", displayName: "Komfort", priceCents: 242049, shortDescription: "Rundum sorglos", includedItems: ["Alles aus Premium", "Einpackservice", "60 bis 80 Umzugskartons", "Fachgerechte Montage", "Entsorgung auf Wunsch"], excludedItems: [], isRecommended: false },
  ].map((o, i) => ({ ...o, catalogueSlug: null, addableItems: [], note: null, sortOrder: i }));
  return {
    features: { liveTracking: live, payments: false, signature: false },
    stage, dealNumber: "VORSCHAU-2026", customerDisplayName: "Alex Beispiel", customerEmailStatus: "present", customerEmailMasked: "a***@example.invalid",
    branding: { firmaSlug: "kottke", displayName: "Kottke-Umzüge", primaryColor: "c2570c", logoUrl: "/branding/kottke/logo.png", footer: "Kottke-Umzüge · Lokale Designvorschau", googleReviewUrl: "https://example.invalid/review", whatsappNumberE164: "490000000000", bank: { iban: null, bic: null, holder: null }, paypal: { handleOrEmail: null }, agbVersion: "preview", agbPdfUrl: null, ansprechpartner: { name: "Dario Kottke", rolle: "Inhaber", fotoUrl: "/branding/kottke/dario-160.jpg", unterschriftUrl: "/branding/kottke/unterschrift-dario.png" }, logoJeLeistung: { move: "/branding/kottke/logo-umzuege.png", clearance: "/branding/kottke/logo-entruempelung.png", kitchen_installation: "/branding/kottke/logo-kuechen.png" } },
    scope: { moveDate: "2026-11-27", timeStart: "08:00", timeEnd: null, fromAddress: "Beispielstraße 16, 70806 Kornwestheim", toAddress: "Musterstraße 15, 74382 Neckarwestheim", floorsFrom: 6, floorsTo: 0, accessFrom: "Aufzug vorhanden", accessTo: null, volumeCbm: null, workerCount: 4, transporterName: "LKW", specialRequests: "Möbel laut zugesandten Fotos; die Küche wird nicht mit umgezogen. Zusätzlich Keller: 1 Fahrrad, 2 Regale und ein Gefrierschrank.", inventoryNotes: null },
    inclusions: { included: [], optional: [] }, packages: { available: [], selectedSlug: null }, dealPackageOffers: { options: single ? [options[1]] : options, selectedOptionId: "premium" }, dateOffers: { options: [], selection: null },
    crew: [{ employeeId: "preview-crew", name: "Mika Beispiel", role: "Teamleitung", photoBase64DataUrl: null }],
    kva: { isVariable: false, fixedPriceCents: 163049, lineItems: [], notes: null, totalCents: 163049, depositRequiredCents: null, validUntil: "2026-11-20", summary: "Umzug mit Ab- und Aufbau der vereinbarten Möbel.", showStandardInclusions: false, calculationAssumptions: null },
    acceptance: stage > 1 ? { signedAt: "2026-09-06T10:00:00Z", acceptedFullName: "Alex Beispiel", widerrufVerzichtAccepted: false, agbVersionAccepted: "preview", confirmedTotalCents: 163049, selectedOptionName: "Premium", widerrufModus: "ausgeschlossen", vorzeitigerBeginnVerlangt: false, quotationDocumentId: null, unterschrift: null } : null,
    annahmeRecht: { ...annahmeRegeln({ serviceType: "move", moveDate: "2026-11-27", hasOpenDateChoice: false, now: new Date("2026-09-06T10:00:00Z") }), kontakt: firmaKontakt("kottke") },
    leistung: "move",
    fruehereAnnahmeAufgehoben: false,
    widerruf: { aktiv: false, fristEnde: null, name: null, vertrag: null, emailMaskiert: null, whatsapp: false, annahmeAm: null, eingegangen: null },
    documents: { orderConfirmationUrl: stage > 1 ? "/api/public/local-preview-only/documents/preview-document" : null, invoiceUrl: stage === 4 ? "/api/public/local-preview-only/documents/preview-invoice" : null, signedContractUrl: null }, attachments: [], customerPhotos: [], furnitureList: [],
    timing: { departureAt: live || stage === 4 ? "2026-11-27T06:45:00Z" : null, onsiteAt: live || stage === 4 ? "2026-11-27T07:28:00Z" : null, finishedAt: stage === 4 ? "2026-11-27T14:30:00Z" : null },
    payment: stage === 4 ? { method: "cash", amountCents: 163049, reference: "VORSCHAU-2026", bank: null, paypalUrl: null, girocodePayload: null } : null,
    customerSignals: { markedPaidDepositAt: null, markedPaidFinalAt: null, crewRatedAt: null }, meta: { serverTime: "2026-09-06T10:00:00Z", revoked: false, featureDisabled: false, canonicalHost: null },
  };
}

/**
 * Finished fixed-price quotation without deal-specific options, while the
 * company catalogue (Basis/Komfort/Premium, partly unpriced) is still present.
 * The portal must show the Festangebot, not those catalogue cards.
 */
export function festangebotFixture(): CustomerPortalContext {
  const ctx = portalFixture(1);
  const catalogue: OfferPackage[] = [
    { slug: "basis", displayName: "Basis", shortDescription: "Nur Transport", targetSegment: null, priceFromCents: null, priceFixedFlag: false, includedItems: ["Transport laut Angebot"], isRecommended: false, sortOrder: 0 },
    { slug: "komfort", displayName: "Komfort", shortDescription: "Mit Verpackung", targetSegment: null, priceFromCents: 129000, priceFixedFlag: true, includedItems: ["Transport", "Verpackung"], isRecommended: true, sortOrder: 1 },
    { slug: "premium", displayName: "Premium", shortDescription: "Rundum", targetSegment: null, priceFromCents: null, priceFixedFlag: false, includedItems: ["Alles aus Komfort"], isRecommended: false, sortOrder: 2 },
  ];
  ctx.dealNumber = "AU-850";
  ctx.customerDisplayName = "Alex Beispiel";
  ctx.packages = { available: catalogue, selectedSlug: null };
  ctx.dealPackageOffers = { options: [], selectedOptionId: null };
  ctx.scope = {
    ...ctx.scope,
    moveDate: "2026-11-27",
    timeStart: "08:00",
    timeEnd: null,
    fromAddress: "Beispielstraße 16, 70806 Kornwestheim",
    toAddress: "Musterstraße 15, 74382 Neckarwestheim",
    floorsFrom: 6,
    floorsTo: 0,
    accessFrom: "Aufzug vorhanden",
    accessTo: "Halteverbotszone",
    volumeCbm: null,
    workerCount: null,
    specialRequests: "Die Küche bleibt vor Ort.",
    inventoryNotes: null,
  };
  ctx.inclusions = {
    included: [
      { key: "blankets", label: "Decken und Polstermaterial", detail: null },
      { key: "tools", label: "Werkzeug (Sackkarre, Gurte, Möbelhund)", detail: null },
      { key: "load_unload", label: "An- und Abladen", detail: null },
    ],
    optional: [{ key: "packing", label: "Einpackservice", detail: null }],
  };
  ctx.kva = {
    isVariable: false,
    fixedPriceCents: 85000,
    lineItems: [{ type: "other", description: "Umzugspauschale laut Besichtigung", quantity: 1, unitRate: 850, lineTotal: 850 }],
    notes: "Interne Kalkulation: nicht an den Kunden. Marge 18 %.",
    totalCents: 85000,
    depositRequiredCents: 10000,
    validUntil: "2026-11-20",
    summary: "Umzug der Wohnung inklusive Transport der besprochenen Möbel.",
    showStandardInclusions: true,
    calculationAssumptions: { etageVon: "6. OG", etageBis: "EG", zugangVon: "Aufzug vorhanden", zugangBis: "Halteverbotszone", hinweis: null },
  };
  return ctx;
}

// ─── Plan 5b: Pakete × Tage, nur Tage, nur Pakete, Stunden ─────────────────

/**
 * Kundenpreise einer gesperrten Version (Euro), wie Task K sie in Optionen und
 * Terminangebote schreibt: Paketpreise am Basistag (Fr 27.11.) und je Tag.
 * Nur Kundenpreise; Selbstkosten und Marge gibt es im Portal nicht.
 */
export const VERSION_5B = {
  pakete: [
    { slug: "basis", name: "Basis", eur: 1190, kurz: "Transport mit Team", items: ["Transport laut Angebot", "Tragehelfer und Transporter"] },
    { slug: "komfort", name: "Komfort", eur: 1490, kurz: "Mit Montage und Halteverbot", items: ["Alles aus Basis", "Ab- und Aufbau der Möbel", "Halteverbotszone"] },
    { slug: "premium", name: "Premium", eur: 1890, kurz: "Rundum, inklusive Einpacken", items: ["Alles aus Komfort", "Einpackservice", "Küchenmontage"] },
  ],
  tage: [
    { id: "tag-fr", datum: "2026-11-27", eur: 1490, pakete: { basis: 1190, komfort: 1490, premium: 1890 }, empfohlen: true, note: null },
    { id: "tag-sa", datum: "2026-11-28", eur: 1640, pakete: { basis: 1310, komfort: 1640, premium: 2060 }, empfohlen: false, note: "Samstag" },
    { id: "tag-mo", datum: "2026-11-30", eur: 1390, pakete: { basis: 1110, komfort: 1390, premium: 1770 }, empfohlen: false, note: null },
  ],
  /** Posten von Komfort am Fr 27.11. (Summe 1.490 €). */
  posten: [
    { description: "Umzug laut Besichtigung", eur: 1100 },
    { description: "Halteverbotszone", eur: 180 },
    { description: "Ab- und Aufbau der Möbel", eur: 210 },
  ],
} as const;

const cent = (eur: number) => Math.round(eur * 100);

function terminAngebote(mitPaketen: boolean): DateOfferOption[] {
  return VERSION_5B.tage.map((t, i) => ({
    id: t.id,
    date: t.datum,
    slots: [{ label: "vormittags", startTime: "08:00", endTime: "12:00" }, { label: "ganztags", startTime: "08:00", endTime: "17:00" }],
    note: t.note,
    isRecommended: t.empfohlen,
    sortOrder: i,
    priceCents: cent(mitPaketen ? t.pakete.komfort : t.eur),
    packagePrices: mitPaketen ? Object.fromEntries(Object.entries(t.pakete).map(([s, e]) => [s, cent(e)])) : null,
  }));
}

function postenKomfort() {
  return VERSION_5B.posten.map((p) => ({ type: "other" as const, description: p.description, quantity: 1, unitRate: p.eur, lineTotal: p.eur }));
}

/** Pakete × Tage (Schalter „Angebot aus Kalkulation“ und „Tagespreise“). `gewaehlt`: Tag-ID oder null (Wahl offen). */
export function paketeTageFixture(gewaehlt: string | null = "tag-sa"): CustomerPortalContext {
  const ctx = portalFixture(1);
  ctx.dealPackageOffers = {
    options: VERSION_5B.pakete.map((p, i) => ({
      id: `opt-${p.slug}`, catalogueSlug: p.slug, displayName: p.name, shortDescription: p.kurz, priceCents: cent(p.eur),
      includedItems: [...p.items], excludedItems: [], addableItems: [], note: null, isRecommended: p.slug === "komfort", sortOrder: i,
    })),
    selectedOptionId: "opt-komfort",
  };
  ctx.dateOffers = { options: terminAngebote(true), selection: null };
  ctx.kva = { ...ctx.kva!, fixedPriceCents: 149000, totalCents: 149000, lineItems: postenKomfort(), calculationVersionId: "preview-v3", validUntil: "2026-11-20", summary: "Umzug der 3-Zimmer-Wohnung, Preis je Paket und Termin." };
  ctx.scope = { ...ctx.scope, moveDate: "2026-11-27" };
  if (gewaehlt) return imFixtureWaehlen(ctx, { dateOfferId: gewaehlt });
  ctx.annahmeRecht = { ...annahmeRegeln({ serviceType: "move", moveDate: "2026-11-27", hasOpenDateChoice: true, now: new Date(ctx.meta.serverTime) }), kontakt: firmaKontakt("kottke") };
  return ctx;
}

/** Nur Tagespreise, Festangebot ohne Pakete. */
export function nurTageFixture(gewaehlt: string | null = "tag-sa"): CustomerPortalContext {
  const ctx = festangebotFixture();
  ctx.dateOffers = { options: terminAngebote(false), selection: null };
  ctx.kva = { ...ctx.kva!, fixedPriceCents: 149000, totalCents: 149000, lineItems: postenKomfort(), calculationVersionId: "preview-v3", depositRequiredCents: 20000 };
  if (gewaehlt) return imFixtureWaehlen(ctx, { dateOfferId: gewaehlt });
  ctx.annahmeRecht = { ...annahmeRegeln({ serviceType: "move", moveDate: "2026-11-27", hasOpenDateChoice: true, now: new Date(ctx.meta.serverTime) }), kontakt: firmaKontakt("kottke") };
  return ctx;
}

/** Nur Paketpreise aus der Version (ohne Tage): Posten des gewählten Pakets. */
export function nurPaketeFixture(): CustomerPortalContext {
  const ctx = paketeTageFixture(null);
  ctx.dateOffers = { options: [], selection: null };
  ctx.annahmeRecht = { ...annahmeRegeln({ serviceType: "move", moveDate: "2026-11-27", hasOpenDateChoice: false, now: new Date(ctx.meta.serverTime) }), kontakt: firmaKontakt("kottke") };
  return ctx;
}

/** Stunden-KV aus der Version: 3 Helfer, 1 Transporter, 5,5 h geschätzt, mindestens 3 h. */
export function stundenFixture(): CustomerPortalContext {
  const ctx = portalFixture(1);
  ctx.dealPackageOffers = { options: [], selectedOptionId: null };
  ctx.kva = {
    ...ctx.kva!,
    isVariable: true,
    fixedPriceCents: null,
    totalCents: 71500,
    calculationVersionId: "preview-v4",
    summary: "Umzug nach Aufwand, Team mit drei Helfern und einem Transporter.",
    lineItems: [
      { type: "helper", description: "Helfer", quantity: 3, unitRate: 35, lineTotal: 105 },
      { type: "transporter", description: "Transporter", quantity: 1, unitRate: 25, lineTotal: 25 },
    ],
    stunden: { helfer: 3, transporter: 1, stundenGeschaetzt: 5.5, mindestStunden: 3, satzHelferEur: 35, satzTransporterEur: 25, summeGeschaetztCent: 71500, mindestbetragCent: 39000, quelle: "version" },
    stundenModell: "version",
  };
  return ctx;
}

/** Stunden-KV von Hand (Altbestand, F11): Postensumme ist der Stundensatz. */
export function stundenAltFixture(): CustomerPortalContext {
  const ctx = stundenFixture();
  const { stunden: _s, ...kva } = ctx.kva!;
  void _s;
  ctx.kva = { ...kva, totalCents: 9500, calculationVersionId: null, stundenModell: "alt", lineItems: [
    { type: "helper", description: "Helfer", quantity: 2, unitRate: 35, lineTotal: 70 },
    { type: "transporter", description: "Transporter", quantity: 1, unitRate: 25, lineTotal: 25 },
  ] };
  return ctx;
}

/**
 * Kundenwahl wie der Server nach Task T: Auswahl setzen, Preis der Wahl aus
 * den Kundenpreisen (Tag vor Paket), Termin auf den Deal spiegeln.
 */
export function imFixtureWaehlen(ctx: CustomerPortalContext, wahl: { optionId?: string; dateOfferId?: string }): CustomerPortalContext {
  const dealPackageOffers = wahl.optionId ? { ...ctx.dealPackageOffers, selectedOptionId: wahl.optionId } : ctx.dealPackageOffers;
  const tag = wahl.dateOfferId ? ctx.dateOffers.options.find((o) => o.id === wahl.dateOfferId) : undefined;
  const dateOffers = tag
    ? { ...ctx.dateOffers, selection: { dateOfferId: tag.id, selectedDate: tag.date, slotLabel: "vormittags", startTime: "08:00", endTime: "12:00", selectedAt: "2026-09-06T09:30:00Z" } }
    : ctx.dateOffers;
  const option = dealPackageOffers.options.find((o) => o.id === dealPackageOffers.selectedOptionId);
  const preis = erwarteterGesamtpreis({
    dealOptions: dealPackageOffers.options,
    selectedOptionId: option?.id ?? null,
    totalCents: ctx.kva?.totalCents ?? 0,
    dateOffers: terminPreise(dateOffers.options),
    selectedDateOfferId: dateOffers.selection?.dateOfferId ?? null,
  });
  const moveDate = dateOffers.selection?.selectedDate ?? ctx.scope.moveDate;
  return {
    ...ctx,
    dealPackageOffers,
    dateOffers,
    kva: ctx.kva ? { ...ctx.kva, totalCents: preis, fixedPriceCents: preis } : ctx.kva,
    scope: { ...ctx.scope, moveDate, timeStart: dateOffers.selection?.startTime ?? ctx.scope.timeStart, timeEnd: dateOffers.selection?.endTime ?? ctx.scope.timeEnd },
    annahmeRecht: { ...annahmeRegeln({ serviceType: ctx.annahmeRecht.serviceType, moveDate, hasOpenDateChoice: dateOffers.options.length > 0 && !dateOffers.selection, now: new Date(ctx.meta.serverTime) }), kontakt: ctx.annahmeRecht.kontakt, kvStand: ctx.annahmeRecht.kvStand },
  };
}

/** Angenommen mit der aktuellen Wahl (Betrag und Paket wie der Server sie bindet). */
export function angenommenFixture(ctx: CustomerPortalContext): CustomerPortalContext {
  const option = ctx.dealPackageOffers.options.find((o) => o.id === ctx.dealPackageOffers.selectedOptionId);
  return {
    ...ctx,
    stage: 1,
    acceptance: { signedAt: "2026-09-06T10:00:00Z", acceptedFullName: "Alex Beispiel", widerrufVerzichtAccepted: false, agbVersionAccepted: "preview", confirmedTotalCents: ctx.kva!.totalCents, selectedOptionName: option?.displayName ?? null, widerrufModus: "ausgeschlossen", vorzeitigerBeginnVerlangt: false, quotationDocumentId: null, unterschrift: null },
  };
}

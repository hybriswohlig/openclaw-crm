import { describe, expect, it } from "vitest";
import {
  angezeigterPreis,
  annahmeRegeln,
  annahmeSperrgrund,
  erwarteterGesamtpreis,
  gesamtpreisMitWahl,
  gewaehltText,
  paketPreisAmTag,
  stundenAngebotAus,
  stundenAnzeige,
  stundensatzAltCents,
  stundensatzText,
  stundenVersionText,
  stundenZahl,
  tagKurz,
  tagLang,
  terminPreise,
  terminPreisFuerPaket,
  type CustomerPortalContext,
  type ConfirmKvaPayload,
} from "@openclaw-crm/customer-portal-core";
import { wahlPreis, type AngebotsWahl, type Tagespreis, type VersionsPreise } from "@/lib/angebot-wahl";
import {
  VERSION_5B,
  imFixtureWaehlen,
  nurPaketeFixture,
  nurTageFixture,
  paketeTageFixture,
  portalFixture,
  stundenAltFixture,
  stundenFixture,
} from "../../e2e/portal-preview/fixture";

/**
 * Plan 5b, Review Focus 1: für jede Wahl gilt wahlPreis (Version) =
 * Portal-Preis (Preiskarte, Mobil-Leiste, Annahmedialog) = Annahmepreis
 * (Server). Die Fixtures sind dieselben wie in der E2E-Vorschau.
 */

const euro = (c: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(c / 100).replace(/\u00a0/g, " ");

/** Dieselben Kundenpreise als gesperrte Version (Vertrag). */
function version(mitTagen: boolean, mitPaketen: boolean): VersionsPreise {
  const tag = (t: (typeof VERSION_5B.tage)[number]): Tagespreis => ({
    datum: t.datum, wochentag: "fr", feiertag: false, festpreis: mitPaketen ? t.pakete.komfort : t.eur, rechnerFestpreis: null,
    selbstkosten: 900, margeProzent: 35, gruende: [], uebersteuert: null,
    paketpreise: mitPaketen ? VERSION_5B.pakete.map((p) => ({ slug: p.slug, festpreis: t.pakete[p.slug as keyof typeof t.pakete], selbstkosten: 800 })) : null,
    slots: [], note: null, empfohlen: t.empfohlen, vehicleBookingId: null,
  });
  return {
    pricingMode: "fest",
    priceCents: 149000,
    kvItems: [],
    packagePrices: mitPaketen ? VERSION_5B.pakete.map((p) => ({ slug: p.slug, festpreis: p.eur, selbstkosten: 800 })) : [],
    dayPrices: mitTagen ? VERSION_5B.tage.map(tag) : [],
  };
}

/** Preis, den der Server nach einer Wahl prüft: loadKvaSnapshot (totalCents) und annahmePruefen. */
function serverPreis(ctx: CustomerPortalContext): number {
  const optionen = ctx.dealPackageOffers.options;
  const gebunden = optionen.find((o) => o.id === ctx.dealPackageOffers.selectedOptionId) ?? null;
  const totalCents = gesamtpreisMitWahl({
    isVariable: ctx.kva!.isVariable,
    // Regel von vor 5b in loadKvaSnapshot.
    bisherCents: ctx.kva!.isVariable
      ? ctx.kva!.lineItems.reduce((s, li) => s + Math.round(li.lineTotal * 100), 0)
      : gebunden ? gebunden.priceCents : ctx.kva!.fixedPriceCents ?? 0,
    stunden: ctx.kva!.stunden ?? null,
    dealOptions: optionen,
    boundOptionId: gebunden?.id ?? null,
    dateOffers: ctx.dateOffers,
  });
  return erwarteterGesamtpreis({
    dealOptions: optionen,
    selectedOptionId: ctx.dealPackageOffers.selectedOptionId,
    totalCents,
    dateOffers: terminPreise(ctx.dateOffers.options),
    selectedDateOfferId: ctx.dateOffers.selection?.dateOfferId ?? null,
  });
}

describe("eine Wahrheit: wahlPreis = Portal = Annahme (Tabellentest)", () => {
  const faelle: Array<[string, () => CustomerPortalContext, VersionsPreise, AngebotsWahl[]]> = [];
  // Paket × Tag: jede Kombination.
  for (const p of VERSION_5B.pakete) {
    for (const t of VERSION_5B.tage) {
      faelle.push([
        `${p.name} am ${t.datum}`,
        () => imFixtureWaehlen(paketeTageFixture(null), { optionId: `opt-${p.slug}`, dateOfferId: t.id }),
        version(true, true),
        [{ paketSlug: p.slug, datum: t.datum }],
      ]);
    }
  }
  // Nur Tage.
  for (const t of VERSION_5B.tage) {
    faelle.push([`nur Tag ${t.datum}`, () => imFixtureWaehlen(nurTageFixture(null), { dateOfferId: t.id }), version(true, false), [{ paketSlug: null, datum: t.datum }]]);
  }
  // Nur Pakete.
  for (const p of VERSION_5B.pakete) {
    faelle.push([`nur Paket ${p.name}`, () => imFixtureWaehlen(nurPaketeFixture(), { optionId: `opt-${p.slug}` }), version(false, true), [{ paketSlug: p.slug, datum: null }]]);
  }

  for (const [name, ctx, v, [w]] of faelle) {
    it(name, () => {
      const c = ctx();
      const soll = wahlPreis(v, w)!.priceCents;
      expect(serverPreis(c)).toBe(soll);
      expect(angezeigterPreis(c).cents).toBe(soll);
      expect(c.kva!.totalCents).toBe(soll);
      // Paketkarte am gewählten Tag und Termin-Karte für das gewählte Paket zeigen dasselbe.
      const option = c.dealPackageOffers.options.find((o) => o.id === c.dealPackageOffers.selectedOptionId);
      const tag = c.dateOffers.options.find((o) => o.id === c.dateOffers.selection?.dateOfferId) ?? null;
      if (option) expect(paketPreisAmTag(option, tag)).toBe(soll);
      if (tag) expect(terminPreisFuerPaket(tag, option?.catalogueSlug)).toBe(soll);
    });
  }

  it("keins (Festpreis ohne Pakete und Tage): wie vor 5b, totalCents", () => {
    const c = portalFixture(1);
    c.dealPackageOffers = { options: [], selectedOptionId: null };
    expect(angezeigterPreis(c).cents).toBe(c.kva!.totalCents);
    expect(serverPreis(c)).toBe(c.kva!.fixedPriceCents);
    expect(wahlPreis(version(false, false), { paketSlug: null, datum: null })!.priceCents).toBe(149000);
  });

  it("Paket ohne Preis an einem Tag: 0 statt eines falschen Preises (Annahme gesperrt)", () => {
    const c = paketeTageFixture("tag-sa");
    c.dateOffers.options[1] = { ...c.dateOffers.options[1], packagePrices: { komfort: 164000 } };
    const w = imFixtureWaehlen(c, { optionId: "opt-premium" });
    expect(serverPreis(w)).toBe(0);
    expect(angezeigterPreis(w).cents).toBe(0);
    expect(paketPreisAmTag(w.dealPackageOffers.options[2], w.dateOffers.options[1])).toBeNull();
  });
});

describe("Preis vor der Terminwahl", () => {
  it("Pakete × Tage ohne Wahl: Preis am empfohlenen Tag, Annahme mit „date“ gesperrt", () => {
    const c = paketeTageFixture(null);
    const p = angezeigterPreis(c);
    expect(p.tag?.id).toBe("tag-fr");
    expect(p.tagGewaehlt).toBe(false);
    expect(p.cents).toBe(149000);
    expect(c.annahmeRecht.terminFehlt).toBe(true);
  });
  it("Paketkarten zeigen den Preis am empfohlenen Tag", () => {
    const c = paketeTageFixture(null);
    const fr = c.dateOffers.options[0];
    expect(c.dealPackageOffers.options.map((o) => paketPreisAmTag(o, fr))).toEqual([119000, 149000, 189000]);
  });
});

describe("price_changed nach Tageswechsel in einem zweiten Tab", () => {
  const payload = (expectedTotalCents: number): ConfirmKvaPayload => ({
    acceptedOffer: true, acceptedAgb: true, haftungshinweisBestaetigt: true, versicherungGewuenscht: false,
    vorzeitigerBeginnVerlangt: false, expectedTotalCents, fullName: null,
  });
  const regeln = (c: CustomerPortalContext) =>
    annahmeRegeln({ serviceType: "move", moveDate: c.scope.moveDate, hasOpenDateChoice: false, now: new Date("2026-09-06T10:00:00Z") });

  it("Tab A sieht Sa (1.640 €), Tab B wählt Mo (1.390 €): Annahme aus Tab A wird abgelehnt", () => {
    const tabA = imFixtureWaehlen(paketeTageFixture(null), { dateOfferId: "tag-sa" });
    const gesehen = angezeigterPreis(tabA).cents;
    expect(gesehen).toBe(164000);
    // Tab B wählt den Montag; der Server liest den neuen Stand.
    const server = imFixtureWaehlen(tabA, { dateOfferId: "tag-mo" });
    const aktuell = serverPreis(server);
    expect(aktuell).toBe(139000);
    expect(annahmeSperrgrund({ payload: payload(gesehen), regeln: regeln(server), agbVorhanden: false, aktuellerPreisCents: aktuell })).toBe("price_changed");
    // Nach dem Neuladen (Dialog lädt bei PRICE_CHANGED neu) passt es.
    expect(annahmeSperrgrund({ payload: payload(angezeigterPreis(server).cents), regeln: regeln(server), agbVorhanden: false, aktuellerPreisCents: aktuell })).toBeNull();
  });

  it("Paketwechsel im zweiten Tab bei gewähltem Tag: ebenfalls price_changed", () => {
    const tabA = paketeTageFixture("tag-sa");
    const server = imFixtureWaehlen(tabA, { optionId: "opt-premium" });
    expect(annahmeSperrgrund({ payload: payload(angezeigterPreis(tabA).cents), regeln: regeln(server), agbVorhanden: false, aktuellerPreisCents: serverPreis(server) })).toBe("price_changed");
  });
});

describe("Stunden-KV", () => {
  it("aus der Version: Schätzung als Annahmebetrag, Text nach F10", () => {
    const c = stundenFixture();
    expect(angezeigterPreis(c).cents).toBe(71500);
    expect(serverPreis(c)).toBe(71500);
    const a = stundenAnzeige(c.kva);
    expect(a).toEqual({ modell: "version", stunden: c.kva!.stunden });
    expect(stundenVersionText(c.kva!.stunden!, euro)).toBe("voraussichtlich 715,00 €, abgerechnet nach Aufwand, mindestens 3 Stunden (390,00 €)");
  });
  it("von Hand (alt): „Stundensatz 95 € je Stunde“, Annahmebetrag wie heute", () => {
    const c = stundenAltFixture();
    expect(stundenAnzeige(c.kva)).toEqual({ modell: "alt", satzCents: 9500 });
    expect(stundensatzText(9500, euro)).toBe("Stundensatz 95,00 € je Stunde");
    expect(angezeigterPreis(c).cents).toBe(9500);
    expect(serverPreis(c)).toBe(9500);
  });
  it("Stundensatz wie die Live-Uhr: Helfer × Satz plus Transportersatz", () => {
    expect(stundensatzAltCents([
      { type: "helper", description: "Helfer", quantity: 2, unitRate: 35, lineTotal: 70 },
      { type: "transporter", description: "Transporter", quantity: 3, unitRate: 25, lineTotal: 75 },
    ], 14500)).toBe(9500);
    expect(stundensatzAltCents([{ type: "other", description: "Pauschale", quantity: 1, unitRate: 80, lineTotal: 80 }], 8000)).toBe(8000);
  });
  it("Kontext ohne stundenModell (vor 5b): keine neue Anzeige", () => {
    const { stundenModell: _m, ...kva } = stundenAltFixture().kva!;
    void _m;
    expect(stundenAnzeige(kva)).toBeNull();
  });
  it("document_details.stunden: nur vollständig und aus der Version", () => {
    const s = stundenFixture().kva!.stunden!;
    expect(stundenAngebotAus(s)).toEqual(s);
    expect(stundenAngebotAus({ ...s, quelle: "hand" })).toBeNull();
    expect(stundenAngebotAus({ ...s, mindestStunden: "3" })).toBeNull();
    expect(stundenAngebotAus({ ...s, summeGeschaetztCent: 0 })).toBeNull();
    expect(stundenAngebotAus(null)).toBeNull();
  });
  it("Stunden in Worten", () => {
    expect(stundenZahl(1)).toBe("1 Stunde");
    expect(stundenZahl(3)).toBe("3 Stunden");
    expect(stundenZahl(3.5)).toBe("3,5 Stunden");
  });
});

describe("Wahl in Worten", () => {
  it("Paket am Tag, nur Paket, nur Tag, keins", () => {
    expect(gewaehltText({ paket: "Komfort", tag: "Samstag, 28. November 2026", betrag: "1.640,00 €" })).toBe("Gewählt: Komfort am Samstag, 28. November 2026: 1.640,00 €");
    expect(gewaehltText({ paket: "Komfort", tag: null, betrag: "1.490,00 €" })).toBe("Gewählt: Komfort: 1.490,00 €");
    expect(gewaehltText({ paket: null, tag: "Montag, 30. November 2026", betrag: "1.390,00 €" })).toBe("Gewählt: Termin am Montag, 30. November 2026: 1.390,00 €");
    expect(gewaehltText({ paket: null, tag: null, betrag: "1 €" })).toBeNull();
  });
  it("Tage kurz und lang, ohne Zeitzonen-Verschiebung", () => {
    expect(tagKurz("2026-11-28")).toBe("Sa 28.11.");
    expect(tagLang("2026-11-28")).toBe("Samstag, 28. November 2026");
    expect(tagLang("2027-03-01")).toBe("Montag, 1. März 2027");
  });
  it("keine Gedankenstriche in den Texten", () => {
    const s = stundenFixture().kva!.stunden!;
    for (const t of [stundenVersionText(s, euro), stundensatzText(9500, euro), gewaehltText({ paket: "A", tag: "B", betrag: "C" })!]) {
      expect(t).not.toMatch(/[—–]/);
    }
  });
});

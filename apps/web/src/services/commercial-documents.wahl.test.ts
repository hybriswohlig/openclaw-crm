/**
 * Plan 5b, Task D2: der KV des CRM-Renderers lädt alle Wahlen aus der gesperrten
 * Version (Pakete, Tage, beides) und zeigt sie als „Wählbare Optionen“. Eine
 * Wahrheit: für jede Wahl gilt PDF-Preis = Posten-Summe = `wahlPreis` = Quotation.
 * Datenbank ersetzt (Zeilen je Tabelle).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDocumentModel, priceSourceFromStored, renderHtml } from "@openclaw-crm/document-templates";
import { wahlPreis, type PaketpreisVersion, type Tagespreis, type VersionsPreise } from "@/lib/angebot-wahl";
import type { KvPosten } from "@/services/rechner/kv-posten";

const mocks = vi.hoisted(() => ({
  getQuotation: vi.fn(),
  zeilen: new Map<unknown, unknown[]>(),
}));

vi.mock("@/db", async () => {
  const { objects } = await import("@/db/schema/objects");
  const kette = (): unknown => {
    let tabelle: unknown = null;
    const k: Record<string, unknown> = {};
    for (const f of ["from", "innerJoin", "where", "limit", "orderBy"]) {
      k[f] = (t: unknown) => {
        if (f === "from") tabelle = t;
        return k;
      };
    }
    k.then = (ok: (v: unknown) => unknown, fehler: (e: unknown) => unknown) =>
      Promise.resolve(tabelle === objects ? [{ id: "obj_1" }] : mocks.zeilen.get(tabelle) ?? []).then(ok, fehler);
    return k;
  };
  return { db: { select: () => kette() } };
});
vi.mock("@/services/document-job-context", () => ({ assertDealInWorkspace: async () => true }));
vi.mock("@/services/quotations", () => ({ getQuotation: mocks.getQuotation }));
vi.mock("@/services/doc-customer-name", () => ({
  resolveDocCustomerName: async () => ({ vorname: "Kyra", nachname: "Heiker", fullName: "Kyra Heiker", source: "person" }),
}));
vi.mock("@/services/customer-portal-emails", () => ({ loadCustomerEmail: async () => null }));
vi.mock("@/services/records", () => ({
  getRecord: async (_objekt: string, id: string) =>
    id === "deal_1"
      ? { values: { name: "Umzug Heiker", operating_company: { id: "oc_ceylan", displayName: "Ceylan Umzüge" } } }
      : { values: {} },
}));
vi.mock("@/services/agent/agent-suppress", () => ({
  ladeGespeicherteAnrede: async () => ({}),
  anredeFuerOptOut: () => "sie",
}));
vi.mock("@/services/deal-documents", () => ({ createDealDocument: vi.fn() }));
vi.mock("@/services/rechnung-faellig", () => ({ applyInvoiceDueDate: vi.fn() }));

import { customerDateSelections, quotationPackageOptions } from "@/db/schema/customer-portal";
import { dealCalculationVersions } from "@/db/schema/deal-calculation-versions";
import { loadCommercialModel, wahlenAusVersion, type WahlOption, type WahlVersion } from "./commercial-documents";

const SELBSTKOSTEN = 777.77;
const GRUND = "INTERN-GRUND-SAMSTAG";

/** Kern plus Hebel, Summe = Preis. */
function posten(preis: number, hebel: Array<[string, number]> = []): KvPosten[] {
  const rest = hebel.reduce((s, [, b]) => s + b, 0);
  return [{ description: "Umzug Kern", quantity: 1, unitRate: preis - rest }, ...hebel.map(([d, b]) => ({ description: d, quantity: 1, unitRate: b }))];
}

function paket(slug: string, festpreis: number | null, hebel: Array<[string, number]> = []): PaketpreisVersion {
  return {
    slug,
    festpreis,
    selbstkosten: SELBSTKOSTEN,
    rundungEur: 10,
    margeProzent: 31,
    hinweis: "INTERN-HINWEIS",
    kvItems: festpreis === null ? [] : posten(festpreis, hebel),
  };
}

function tag(datum: string, festpreis: number, paketpreise: PaketpreisVersion[] | null, empfohlen = false): Tagespreis {
  return {
    datum,
    wochentag: "sa",
    feiertag: false,
    festpreis,
    rechnerFestpreis: festpreis,
    selbstkosten: SELBSTKOSTEN,
    margeProzent: 29,
    gruende: [{ text: GRUND, punkte: 3 }],
    uebersteuert: null,
    paketpreise,
    kvItems: posten(festpreis),
    slots: [],
    note: "INTERN-NOTIZ",
    empfohlen,
    vehicleBookingId: null,
  };
}

const HEBEL_KOMFORT: Array<[string, number]> = [["Halteverbot", 150], ["Montage", 130]];
const HEBEL_PREMIUM: Array<[string, number]> = [...HEBEL_KOMFORT, ["Einpacken", 280]];

const pakete = (basis: number, komfort: number, premium: number) => [
  paket("basis", basis),
  paket("komfort", komfort, HEBEL_KOMFORT),
  paket("premium", premium, HEBEL_PREMIUM),
];

const versionPaketeTage: WahlVersion = {
  id: "ver_1",
  pricingMode: "fest",
  priceCents: 160000,
  kvItems: posten(1600),
  packagePrices: pakete(1400, 1780, 2210),
  dayPrices: [
    tag("2026-11-20", 1600, pakete(1400, 1780, 2210)),
    tag("2026-11-21", 1700, pakete(1500, 1890, 2340), true),
  ],
};

const optionen: WahlOption[] = [
  { id: "opt_b", catalogueSlug: "basis", displayName: "Basis", isRecommended: false, sortOrder: 0, calculationVersionId: "ver_1" },
  { id: "opt_k", catalogueSlug: "komfort", displayName: "Komfort", isRecommended: true, sortOrder: 1, calculationVersionId: "ver_1" },
  { id: "opt_p", catalogueSlug: "premium", displayName: "Premium", isRecommended: false, sortOrder: 2, calculationVersionId: "ver_1" },
  // Von Hand: kein Bezug, zählt nicht.
  { id: "opt_h", catalogueSlug: null, displayName: "Einzeltransport", isRecommended: false, sortOrder: 3, calculationVersionId: null },
];

const preiseVon = (v: WahlVersion): VersionsPreise => v;

describe("wahlenAusVersion", () => {
  it("Pakete × Tage: alle Kundenpreise aus wahlPreis, aktuelle Wahl = gebundene Option am Kundentag", () => {
    const r = wahlenAusVersion({
      version: versionPaketeTage,
      optionen,
      gewaehlteOptionId: "opt_p",
      gewaehltesDatum: "2026-11-20",
      festpreisCent: 221000,
    });
    expect(r?.priceCents).toBe(221000);
    expect(r?.choices.packages).toEqual([
      { slug: "basis", name: "Basis" },
      { slug: "komfort", name: "Komfort" },
      { slug: "premium", name: "Premium" },
    ]);
    expect(r?.choices.days).toEqual(["2026-11-20", "2026-11-21"]);
    expect(r?.choices.prices).toHaveLength(6);
    expect(r?.choices.current).toEqual({ packageSlug: "premium", date: "2026-11-20" });
    expect(r?.choices.currentLines?.map((l) => l.description)).toEqual(["Umzug Kern", "Halteverbot", "Montage", "Einpacken"]);
    // Nur Kundenpreise: keine Selbstkosten, Marge, Gründe, Hinweise, Notizen.
    const json = JSON.stringify(r);
    for (const intern of ["777.77", "77777", GRUND, "INTERN-HINWEIS", "INTERN-NOTIZ", "margeProzent", "selbstkosten", "rundung"]) {
      expect(json).not.toContain(intern);
    }
  });

  it("ohne Kundenwahl: empfohlene Option am empfohlenen Tag", () => {
    const r = wahlenAusVersion({
      version: versionPaketeTage,
      optionen,
      gewaehlteOptionId: null,
      gewaehltesDatum: null,
      festpreisCent: 189000,
    });
    expect(r?.choices.current).toEqual({ packageSlug: "komfort", date: "2026-11-21" });
  });

  it("nur Tage (keine Optionen mit Bezug): Tagespreise", () => {
    const r = wahlenAusVersion({
      version: { ...versionPaketeTage, packagePrices: [], dayPrices: versionPaketeTage.dayPrices.map((t) => ({ ...t, paketpreise: null })) },
      optionen: [],
      gewaehlteOptionId: null,
      gewaehltesDatum: "2026-11-20",
      festpreisCent: 160000,
    });
    expect(r?.choices.packages).toEqual([]);
    expect(r?.choices.prices).toEqual([
      { packageSlug: null, date: "2026-11-20", priceCents: 160000 },
      { packageSlug: null, date: "2026-11-21", priceCents: 170000 },
    ]);
  });

  it("nur Pakete: Paketpreise am Basistag", () => {
    const r = wahlenAusVersion({
      version: { ...versionPaketeTage, dayPrices: [] },
      optionen,
      gewaehlteOptionId: "opt_k",
      gewaehltesDatum: "2026-11-21",
      festpreisCent: 178000,
    });
    expect(r?.choices.days).toEqual([]);
    expect(r?.choices.prices.map((p) => p.priceCents)).toEqual([140000, 178000, 221000]);
    expect(r?.choices.current).toEqual({ packageSlug: "komfort", date: null });
  });

  it("kein Block: Altversion, Stunden, Optionen von Hand, Quotation von Hand geändert", () => {
    const basis = { optionen, gewaehlteOptionId: "opt_k", gewaehltesDatum: null };
    // Altversion: keine Tage, Paketpreise ohne passende Option mit Bezug.
    expect(
      wahlenAusVersion({ ...basis, version: { ...versionPaketeTage, dayPrices: [], packagePrices: [] }, festpreisCent: 160000 })
    ).toBeNull();
    expect(
      wahlenAusVersion({ ...basis, version: { ...versionPaketeTage, pricingMode: "stunden" }, festpreisCent: 189000 })
    ).toBeNull();
    expect(
      wahlenAusVersion({
        ...basis,
        version: { ...versionPaketeTage, dayPrices: [] },
        optionen: optionen.map((o) => ({ ...o, calculationVersionId: null })),
        festpreisCent: 178000,
      })
    ).toBeNull();
    expect(wahlenAusVersion({ ...basis, version: versionPaketeTage, festpreisCent: 199900 })).toBeNull();
    expect(wahlenAusVersion({ ...basis, version: versionPaketeTage, festpreisCent: null })).toBeNull();
  });
});

describe("Eine Wahrheit (Review Focus 5b, Punkt 1)", () => {
  const deal = { firma: "ceylan" as const, customerName: "Kyra Heiker", documentDate: "2026-11-07" };
  const faelle: Array<{ name: string; version: WahlVersion; option: string | null; datum: string | null; paketSlug: string | null }> = [
    { name: "Paket und Tag", version: versionPaketeTage, option: "opt_b", datum: "2026-11-21", paketSlug: "basis" },
    { name: "nur Paket", version: { ...versionPaketeTage, dayPrices: [] }, option: "opt_p", datum: null, paketSlug: "premium" },
    {
      name: "nur Tag",
      version: { ...versionPaketeTage, packagePrices: [], dayPrices: versionPaketeTage.dayPrices.map((t) => ({ ...t, paketpreise: null })) },
      option: null,
      datum: "2026-11-21",
      paketSlug: null,
    },
    { name: "keins", version: { ...versionPaketeTage, packagePrices: [], dayPrices: [] }, option: null, datum: null, paketSlug: null },
  ];

  for (const f of faelle) {
    it(`${f.name}: PDF-Preis = Posten-Summe = wahlPreis = Quotation`, () => {
      const soll = wahlPreis(preiseVon(f.version), { paketSlug: f.paketSlug, datum: f.datum });
      expect(soll).not.toBeNull();
      const cent = soll!.priceCents;
      const r = wahlenAusVersion({
        version: f.version,
        optionen: f.paketSlug ? optionen : [],
        gewaehlteOptionId: f.option,
        gewaehltesDatum: f.datum,
        festpreisCent: cent,
      });
      const model = buildDocumentModel({
        kind: "KV",
        deal,
        quotation: priceSourceFromStored({
          isVariable: false,
          fixedPrice: (cent / 100).toFixed(2),
          lineItems: soll!.kvItems.map((p) => ({ type: "other", description: p.description, quantity: p.quantity, unitRate: p.unitRate.toFixed(2) })),
          depositRequiredCents: null,
          paymentMethodPreference: null,
          validUntil: null,
          serviceType: "move",
        }),
        packageOption: f.option ? { displayName: "Paket", priceCents: r?.priceCents ?? cent, includedItems: [] } : null,
        choices: r?.choices ?? null,
      });
      expect(model.totalCents).toBe(cent);
      expect(model.positions.reduce((s, p) => s + p.amountCents, 0)).toBe(cent);
      if (f.name === "keins") {
        expect(r).toBeNull();
        expect(model.choices).toBeUndefined();
        return;
      }
      const aktuell = model.choices!.rows.flatMap((row) => row.cells).filter((c) => c.current);
      expect(aktuell).toHaveLength(1);
      expect(aktuell[0].label.replace(/\s/g, " ")).toBe(
        new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cent / 100).replace(/\s/g, " ")
      );
    });
  }
});

const angebot = (over: Record<string, unknown> = {}) => ({
  id: "q1",
  dealRecordId: "deal_1",
  fixedPrice: "1890.00",
  isVariable: false,
  notes: null,
  summary: null,
  validUntil: null,
  depositRequiredCents: null,
  paymentMethodPreference: null,
  showStandardInclusions: true,
  selectedPackageOptionId: "opt_k",
  serviceType: "move",
  documentDetails: null,
  calculationAssumptions: null,
  calculationVersionId: "ver_1",
  lineItems: posten(1890, HEBEL_KOMFORT).map((p, i) => ({
    id: `l${i}`,
    quotationId: "q1",
    type: "other",
    description: p.description,
    quantity: p.quantity,
    unitRate: p.unitRate.toFixed(2),
    sortOrder: i,
  })),
  ...over,
});

const eingabe = { workspaceId: "ws_1", dealRecordId: "deal_1", kind: "KV" as const, now: new Date("2026-11-07T10:00:00Z") };

describe("loadCommercialModel mit Version", () => {
  beforeEach(() => {
    mocks.zeilen.clear();
    mocks.getQuotation.mockReset();
  });

  it("KV mit Paketen und Tagen: Posten der Wahl, Block mit allen Preisen, keine internen Zahlen", async () => {
    mocks.getQuotation.mockResolvedValue(angebot());
    mocks.zeilen.set(dealCalculationVersions, [versionPaketeTage]);
    // Optionszeile kennt nur den Paketpreis am Basistag (1.780 €); gilt der Preis am Tag.
    mocks.zeilen.set(quotationPackageOptions, [
      ...optionen.map((o) => ({ ...o, priceCents: 178000, includedItems: [] })),
    ]);
    mocks.zeilen.set(customerDateSelections, [{ selectedDate: "2026-11-21" }]);
    const model = await loadCommercialModel(eingabe);
    expect(model.totalCents).toBe(189000);
    expect(model.positions.map((p) => p.title)).toEqual(["Umzug Kern", "Halteverbot", "Montage"]);
    expect(model.offerLabel).toBe("Preis für Komfort am Sa., 21.11.2026");
    expect(model.choices?.header).toEqual(["Termin", "Basis", "Komfort", "Premium"]);
    const html = renderHtml(model);
    expect(html).toContain("Den Preis legen Sie mit Ihrer Wahl im Kundenportal fest.");
    for (const intern of ["777,77", GRUND, "INTERN-HINWEIS", "INTERN-NOTIZ", "Einzeltransport"]) {
      expect(html).not.toContain(intern);
    }
  });

  it("AB lädt keine Wahlen", async () => {
    mocks.getQuotation.mockResolvedValue(angebot());
    mocks.zeilen.set(dealCalculationVersions, [versionPaketeTage]);
    const model = await loadCommercialModel({ ...eingabe, kind: "AB" });
    expect(model.choices).toBeUndefined();
  });

  it("Altbestand: Version ohne Wahlen ergibt dasselbe Modell wie ohne Version", async () => {
    const alt = angebot({ fixedPrice: "1600.00", selectedPackageOptionId: null, lineItems: [] });
    mocks.getQuotation.mockResolvedValue({ ...alt, calculationVersionId: null });
    const ohne = await loadCommercialModel(eingabe);
    mocks.getQuotation.mockResolvedValue(alt);
    mocks.zeilen.set(dealCalculationVersions, [{ ...versionPaketeTage, packagePrices: [], dayPrices: [] }]);
    const mit = await loadCommercialModel(eingabe);
    expect(mit).toEqual(ohne);
    expect(mit.choices).toBeUndefined();
  });
});

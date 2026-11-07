import { describe, expect, it } from "vitest";
import { kernBefund, wahlPreis, type PaketpreisVersion, type RechnerStunden, type Tagespreis, type VersionsPreise } from "@/lib/angebot-wahl";
import type { RechnerErgebnis } from "./client";
import type { HebelArt } from "./kv-posten";
import { kvBausteine } from "./kv-posten";
import { postenJeWahl, stundenPosten } from "./wahl-posten";

const inCent = (eur: number) => Math.round(eur * 100);
const postenCent = (posten: ReadonlyArray<{ unitRate: number; quantity: number }>) =>
  posten.reduce((s, p) => s + inCent(p.unitRate) * p.quantity, 0);

const ergebnis = {
  preis: {
    festpreis: 1730,
    posten: [
      { bezeichnung: "Arbeitsstunden (ohne Küche)", menge: 22.5, einheit: "Std", satz: 35, betrag: 786.38 },
      { bezeichnung: "Halteverbotszone", menge: 2, einheit: "Stück", satz: 150, betrag: 300 },
    ],
  },
  zeiten: { demontage: 84, montage: 114, packen: 0 },
  team: { groesse: 4 },
  positionen: [
    { name: "Schreibtisch", menge: 1, volumenCbm: 0.7, zerlegt: true },
    { name: "Boxspringbett", menge: 1, volumenCbm: 2, zerlegt: true },
    { name: "Esstisch", menge: 1, volumenCbm: 1, zerlegt: true },
  ],
} as RechnerErgebnis;

const anfrage = {
  von_adresse: "Lerchenstraße 78, 70176 Stuttgart",
  nach_adresse: "Friedenstraße 5, 70190 Stuttgart",
  von_halteverbot: "on",
  nach_halteverbot: "on",
};

const paketHebel: Record<string, HebelArt[]> = {
  basis: [],
  komfort: ["montage", "halteverbot"],
  eng: ["montage", "halteverbot"],
  "zu-klein": ["montage", "halteverbot"],
};

function paket(slug: string, festpreis: number | null): PaketpreisVersion {
  return { slug, festpreis, selbstkosten: 400 };
}

function tag(datum: string, festpreis: number | null, extra?: Partial<Tagespreis>): Tagespreis {
  return {
    wochentag: "sa",
    feiertag: false,
    rechnerFestpreis: festpreis,
    selbstkosten: 400,
    margeProzent: 30,
    gruende: [],
    uebersteuert: null,
    paketpreise: null,
    slots: [],
    note: null,
    empfohlen: false,
    vehicleBookingId: null,
    ...extra,
    datum,
    festpreis,
  };
}

function version(): VersionsPreise {
  return {
    pricingMode: "fest",
    priceCents: inCent(2260),
    kvItems: [],
    packagePrices: [
      paket("komfort", 2260),
      paket("basis", 1840),
      paket("eng", 500),
      paket("zu-klein", 100),
      paket("leer", null),
    ],
    dayPrices: [
      tag("2026-11-21", 2400, {
        empfohlen: true,
        paketpreise: [paket("basis", 2000), paket("komfort", 2500), paket("leer", null)],
      }),
      tag("2026-11-22", 1999.99),
    ],
  };
}

function bauen(v: VersionsPreise, einPosten = false) {
  return postenJeWahl({ ergebnis, anfrage, version: v, paketHebel, einPosten });
}

describe("postenJeWahl", () => {
  const aus = bauen(version());

  it.each([
    ["keins", null, null],
    ["nur Paket", "komfort", null],
    ["nur Tag", null, "2026-11-21"],
    ["Paket und Tag", "basis", "2026-11-21"],
    ["Tag mit Bruchteilen von Cent", null, "2026-11-22"],
  ] as const)("%s: Summe der Posten ist der Preis auf den Cent", (_name, slug, datum) => {
    const w = wahlPreis(aus, { paketSlug: slug, datum });
    expect(w).not.toBeNull();
    expect(postenCent(w!.kvItems)).toBe(w!.priceCents);
  });

  it("lässt die Vorlage unverändert", () => {
    const v = version();
    bauen(v);
    expect(v.kvItems).toEqual([]);
    expect(v.packagePrices[0]?.kvItems).toBeUndefined();
    expect(v.dayPrices[0]?.kvItems).toBeUndefined();
  });

  it("Basis ohne Hebel: ein Kernposten und nichts daneben", () => {
    const items = aus.packagePrices.find((p) => p.slug === "basis")!.kvItems!;
    expect(items).toHaveLength(1);
    expect(items[0]!.description.startsWith("Umzugsteam")).toBe(true);
    expect(items[0]!.description).not.toMatch(/Demontage|Halteverbot|Einpack|Küche/);
    expect(postenCent(items)).toBe(inCent(1840));
  });

  it("hält einen kleinen Kern getrennt", () => {
    const items = aus.packagePrices.find((p) => p.slug === "eng")!.kvItems!;
    expect(items.length).toBeGreaterThan(1);
    expect(items[0]!.unitRate).toBeLessThan(250);
    expect(postenCent(items)).toBe(inCent(500));
    expect(kernBefund(items).art).toBe("klein");
  });

  it("gibt einen Kern ≤ 0 nicht als Posten aus; kernBefund meldet negativ", () => {
    const k = kvBausteine({
      festpreis: 100,
      ergebnis,
      anfrage,
      festpreisIstEndpreis: true,
      hebelNur: ["montage", "halteverbot"],
      zusammenklappen: "nie",
    });
    expect(k.kern).toBeLessThanOrEqual(0);
    const items = aus.packagePrices.find((p) => p.slug === "zu-klein")!.kvItems!;
    expect(items.every((p) => p.unitRate > 0)).toBe(true);
    expect(items.some((p) => p.unitRate <= 0)).toBe(false);
    expect(kernBefund([{ description: "Kern", quantity: 1, unitRate: k.kern }, ...items])).toEqual({ art: "negativ" });
  });

  it("lässt eine Wahl ohne Preis ohne Posten", () => {
    expect(aus.packagePrices.find((p) => p.slug === "leer")!.kvItems).toEqual([]);
    expect(aus.dayPrices[0]!.paketpreise!.find((p) => p.slug === "leer")!.kvItems).toEqual([]);
  });

  it("ein Posten trägt den heutigen Sammeltext und den vollen Preis", () => {
    const sammeln = kvBausteine({ festpreis: 500, ergebnis, anfrage });
    expect(sammeln.posten).toHaveLength(1);
    const einer = bauen(version(), true);
    expect(einer.kvItems).toEqual([
      { description: sammeln.posten[0]!.description, quantity: 1, unitRate: 2260 },
    ]);
    expect(postenCent(einer.kvItems)).toBe(inCent(2260));
    const basis = einer.packagePrices.find((p) => p.slug === "basis")!.kvItems!;
    expect(basis).toHaveLength(1);
    expect(basis[0]!.description).not.toMatch(/Demontage|Halteverbot/);
    expect(postenCent(basis)).toBe(inCent(1840));
  });

  it("gleicht einen krummen Hebel auf den Cent des Paketpreises aus", () => {
    const krumm = {
      ...ergebnis,
      preis: {
        ...ergebnis.preis,
        posten: ergebnis.preis!.posten!.map((p) => (p.bezeichnung === "Halteverbotszone" ? { ...p, satz: 150.005 } : p)),
      },
    } as RechnerErgebnis;
    const v = version();
    v.packagePrices = [paket("komfort", 1000)];
    const ausKrumm = postenJeWahl({ ergebnis: krumm, anfrage, version: v, paketHebel, einPosten: false });
    const items = ausKrumm.packagePrices[0]!.kvItems!;
    expect(items.length).toBeGreaterThan(1);
    expect(postenCent(items)).toBe(inCent(1000));
  });
});

describe("stundenPosten", () => {
  const stunden: RechnerStunden = {
    helfer: 3,
    transporter: 2,
    stundenGeschaetzt: 7.5,
    mindestStunden: 3,
    satzHelferEur: 35,
    satzTransporterEur: 25,
    zusatzposten: [
      { key: "halteverbot", bezeichnung: "Halteverbotszone", betrag: 150 },
      { key: "material", bezeichnung: "Material", betrag: 40 },
    ],
    summeGeschaetztEur: 980.5,
    mindestbetragEur: 465,
  };

  it("setzt Helfer, Transporter und Zusatzposten und das Stundenangebot in Cent", () => {
    expect(stundenPosten(stunden)).toEqual({
      posten: [
        { type: "helper", description: "Helfer", quantity: 3, unitRate: 35 },
        { type: "transporter", description: "Transporter", quantity: 2, unitRate: 25 },
        { type: "other", description: "Halteverbotszone", quantity: 1, unitRate: 150 },
        { type: "other", description: "Material", quantity: 1, unitRate: 40 },
      ],
      angebot: {
        helfer: 3,
        transporter: 2,
        stundenGeschaetzt: 7.5,
        mindestStunden: 3,
        satzHelferEur: 35,
        satzTransporterEur: 25,
        summeGeschaetztCent: 98_050,
        mindestbetragCent: 46_500,
        quelle: "version",
      },
    });
  });
});

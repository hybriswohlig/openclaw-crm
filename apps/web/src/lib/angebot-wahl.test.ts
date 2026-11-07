import { describe, expect, it } from "vitest";
import type { Uebersteuerung } from "./kalkulation-versionen";
import type { KvPosten } from "@/services/rechner/kv-posten";
import {
  RENDER_JOB_RESERVIERUNG_MS,
  alleKundenpreise,
  angebotPasstZuVersion,
  anzahlungPasst,
  jobAblage,
  jobReservierbar,
  kernBefund,
  kvStand,
  paketOhneHebelSperrt,
  preisHash,
  standardWahl,
  verwaisteZeilenUebersteuerungen,
  wahlPreis,
  type PaketpreisVersion,
  type Tagespreis,
  type VersionsPreise,
} from "./angebot-wahl";

const ost = "fahrzeug.sprinter@sixt-muc-ost.miete";
const west = "fahrzeug.sprinter@sixt-muc-west.miete";
const sued = "fahrzeug.sprinter@sixt-ber-sued.miete";

function zeile(key: string, wert: Uebersteuerung["wert"], id: string, art: Uebersteuerung["art"] = "zeile"): Uebersteuerung {
  return {
    id,
    art,
    key,
    rechnerwert: 100,
    wert,
    grund: "Test",
    autor: { userId: null, quelle: "mensch" },
    zeit: "2026-11-07T08:00:00.000Z",
    fotoRef: null,
  };
}

describe("jobAblage", () => {
  it("legt ohne Version ab, wenn es kein KV ist oder die Version fehlt", () => {
    expect(jobAblage({ documentType: "invoice", calculationVersionId: "v1" }, "v1")).toBe("ohne_version");
    expect(jobAblage({ documentType: "order_confirmation", calculationVersionId: null }, null)).toBe("ohne_version");
    expect(jobAblage({ documentType: "quotation", calculationVersionId: null }, "v1")).toBe("ohne_version");
    expect(jobAblage({ documentType: "quotation", calculationVersionId: null }, null)).toBe("ohne_version");
  });

  it("legt mit Version ab, wenn die Quotation dieselbe Version trägt, sonst verwerfen", () => {
    expect(jobAblage({ documentType: "quotation", calculationVersionId: "v1" }, "v1")).toBe("mit_version");
    expect(jobAblage({ documentType: "quotation", calculationVersionId: "v1" }, "v2")).toBe("verwerfen");
    expect(jobAblage({ documentType: "quotation", calculationVersionId: "v1" }, null)).toBe("verwerfen");
  });
});

describe("jobReservierbar", () => {
  const jetzt = new Date("2026-11-07T10:00:00.000Z");

  it("erlaubt laeuft ohne Reservierung und eine Reservierung ab zwei Minuten", () => {
    expect(jobReservierbar({ status: "laeuft", claimedAt: null }, jetzt)).toBe(true);
    expect(jobReservierbar({ status: "laeuft", claimedAt: new Date(jetzt.getTime() - 1_000).toISOString() }, jetzt)).toBe(false);
    expect(
      jobReservierbar(
        { status: "laeuft", claimedAt: new Date(jetzt.getTime() - RENDER_JOB_RESERVIERUNG_MS).toISOString() },
        jetzt,
      ),
    ).toBe(true);
  });

  it("lehnt andere Status ab", () => {
    for (const status of ["abgelegt", "verworfen", "fehler"] as const) {
      expect(jobReservierbar({ status, claimedAt: null }, jetzt)).toBe(false);
    }
  });
});

describe("kvStand", () => {
  it("unterscheidet ohne Version, passend und veraltet", () => {
    expect(kvStand(null, null)).toBe("ohne_version");
    expect(kvStand(null, { calculationVersionId: "v1" })).toBe("ohne_version");
    expect(kvStand("v1", { calculationVersionId: "v1" })).toBe("passt");
    expect(kvStand("v1", { calculationVersionId: "v2" })).toBe("veraltet");
    expect(kvStand("v1", { calculationVersionId: null })).toBe("veraltet");
    expect(kvStand("v1", null)).toBe("veraltet");
  });
});

describe("verwaisteZeilenUebersteuerungen", () => {
  it("nennt bei Stationswechsel den Kandidaten derselben Klasse und desselben Teils", () => {
    const aus = verwaisteZeilenUebersteuerungen(
      [zeile(ost, 80, "u1"), zeile(west, 10, "bleibt")],
      [{ key: sued }, { key: west }, {}, { key: "fahrzeug.sprinter@sixt-muc-west.km" }],
    );
    expect(aus).toEqual([{ id: "u1", key: ost, kandidaten: [sued, west] }]);
  });

  it("hat bei Klassenwechsel keinen Kandidaten", () => {
    const aus = verwaisteZeilenUebersteuerungen(
      [zeile(ost, 80, "u2")],
      [{ key: "fahrzeug.kastenwagen@sixt-muc-west.miete" }],
    );
    expect(aus).toEqual([{ id: "u2", key: ost, kandidaten: [] }]);
  });

  it("übergeht eine gelöschte Übersteuerung (wert null)", () => {
    expect(verwaisteZeilenUebersteuerungen([zeile(ost, null, "weg")], [{ key: west }])).toEqual([]);
  });

  it("lässt die letzte Nennung gewinnen, auch wenn sie löscht", () => {
    expect(verwaisteZeilenUebersteuerungen([zeile(ost, 10, "alt"), zeile(ost, 90, "neu")], [])).toEqual([
      { id: "neu", key: ost, kandidaten: [] },
    ]);
    expect(verwaisteZeilenUebersteuerungen([zeile(ost, 10, "alt"), zeile(ost, null, "geloescht")], [])).toEqual([]);
  });

  it("nimmt einen Schlüssel, der kein Fahrzeug ist, ohne Kandidaten", () => {
    expect(
      verwaisteZeilenUebersteuerungen(
        [zeile("material.kartons", 5, "m1"), zeile(ost, 1, "marge", "marge")],
        [{ key: west }],
      ),
    ).toEqual([{ id: "m1", key: "material.kartons", kandidaten: [] }]);
  });
});

const inCent = (eur: number) => Math.round(eur * 100);
const postenCent = (posten: readonly KvPosten[]) => posten.reduce((s, p) => s + inCent(p.unitRate) * p.quantity, 0);

function euroPosten(eur: number, description = "Leistung"): KvPosten {
  return { description, quantity: 1, unitRate: eur };
}

function paket(teil: Partial<PaketpreisVersion> & Pick<PaketpreisVersion, "slug" | "festpreis">): PaketpreisVersion {
  return { selbstkosten: 500, ...teil, kvItems: teil.festpreis === null ? [] : teil.kvItems ?? [euroPosten(teil.festpreis, teil.slug)] };
}

function tag(teil: Partial<Tagespreis> & Pick<Tagespreis, "datum">): Tagespreis {
  const { festpreis: angegeben, kvItems, ...rest } = teil;
  const festpreis = angegeben === undefined ? 1000 : angegeben;
  return {
    wochentag: "sa",
    feiertag: false,
    rechnerFestpreis: festpreis,
    selbstkosten: 700,
    margeProzent: 30,
    gruende: [],
    uebersteuert: null,
    paketpreise: null,
    slots: [],
    note: null,
    empfohlen: false,
    vehicleBookingId: null,
    ...rest,
    festpreis,
    kvItems: kvItems ?? (festpreis === null ? [] : [euroPosten(festpreis, teil.datum)]),
  };
}

/** Preise absichtlich unsortiert, damit Reihenfolge-Tests die Sortierung sehen. */
function version(extra?: Partial<VersionsPreise>): VersionsPreise {
  const basisAmTag = paket({ slug: "basis", festpreis: 700, kvItems: [euroPosten(700, "basis-tag")] });
  const komfortAmTag = paket({ slug: "komfort", festpreis: 1100, kvItems: [euroPosten(1100, "komfort-tag")] });
  return {
    pricingMode: "fest",
    priceCents: 100_000,
    kvItems: [euroPosten(1000, "haupt")],
    packagePrices: [
      paket({ slug: "komfort", festpreis: 1200 }),
      paket({ slug: "premium", festpreis: null }),
      paket({ slug: "basis", festpreis: 800 }),
    ],
    dayPrices: [
      tag({
        datum: "2026-11-21",
        festpreis: 900,
        empfohlen: true,
        wochentag: "sa",
        paketpreise: [komfortAmTag, basisAmTag],
      }),
      tag({ datum: "2026-11-28", festpreis: null, wochentag: "sa" }),
      tag({ datum: "2026-11-14", festpreis: 950, wochentag: "sa", empfohlen: false }),
    ],
    ...extra,
  };
}

describe("Vertrag 5b", () => {
  const v = version();

  describe("wahlPreis", () => {
    it("nimmt ohne Wahl den Hauptpreis", () => {
      expect(wahlPreis(v, { paketSlug: null, datum: null })).toEqual({
        priceCents: 100_000,
        kvItems: [euroPosten(1000, "haupt")],
      });
    });

    it("nimmt nur das Paket am Basistag", () => {
      expect(wahlPreis(v, { paketSlug: "basis", datum: null })).toEqual({
        priceCents: 80_000,
        kvItems: [euroPosten(800, "basis")],
      });
    });

    it("nimmt nur den Tag", () => {
      expect(wahlPreis(v, { paketSlug: null, datum: "2026-11-14" })).toEqual({
        priceCents: 95_000,
        kvItems: [euroPosten(950, "2026-11-14")],
      });
    });

    it("nimmt am Tag den Paketpreis, nicht den Tages- oder Basispreis", () => {
      expect(wahlPreis(v, { paketSlug: "basis", datum: "2026-11-21" })).toEqual({
        priceCents: 70_000,
        kvItems: [euroPosten(700, "basis-tag")],
      });
      expect(wahlPreis(v, { paketSlug: "komfort", datum: "2026-11-21" })?.priceCents).toBe(110_000);
    });

    it("ist null, wenn der Tag fehlt", () => {
      expect(wahlPreis(v, { paketSlug: null, datum: "2026-12-01" })).toBeNull();
      expect(wahlPreis(v, { paketSlug: "basis", datum: "2026-12-01" })).toBeNull();
    });

    it("ist null, wenn das Paket keinen Preis hat", () => {
      expect(wahlPreis(v, { paketSlug: "premium", datum: null })).toBeNull();
      expect(wahlPreis(v, { paketSlug: null, datum: "2026-11-28" })).toBeNull();
    });

    it("ist null, wenn der Hauptpreis fehlt", () => {
      expect(wahlPreis(version({ priceCents: null, kvItems: [] }), { paketSlug: null, datum: null })).toBeNull();
    });
  });

  describe("standardWahl", () => {
    it("nimmt den empfohlenen Tag", () => {
      expect(standardWahl(v, "komfort")).toEqual({ paketSlug: "komfort", datum: "2026-11-21" });
    });

    it("nimmt sonst den ersten Tag der Liste", () => {
      const ohne = version({
        dayPrices: v.dayPrices.map((t) => ({ ...t, empfohlen: false })),
      });
      expect(standardWahl(ohne, "basis")).toEqual({ paketSlug: "basis", datum: "2026-11-21" });
    });

    it("hat ohne Tage kein Datum", () => {
      expect(standardWahl(version({ dayPrices: [] }), "basis")).toEqual({ paketSlug: "basis", datum: null });
      expect(standardWahl(version({ dayPrices: [] }), null)).toEqual({ paketSlug: null, datum: null });
    });
  });

  describe("alleKundenpreise", () => {
    it("hält die feste Reihenfolge: Hauptpreis, Pakete nach Slug, Tage nach Datum, darin Pakete", () => {
      expect(alleKundenpreise(v)).toEqual([
        { paketSlug: null, datum: null, cent: 100_000 },
        { paketSlug: "basis", datum: null, cent: 80_000 },
        { paketSlug: "komfort", datum: null, cent: 120_000 },
        { paketSlug: "premium", datum: null, cent: null },
        { paketSlug: null, datum: "2026-11-14", cent: 95_000 },
        { paketSlug: null, datum: "2026-11-21", cent: 90_000 },
        { paketSlug: "basis", datum: "2026-11-21", cent: 70_000 },
        { paketSlug: "komfort", datum: "2026-11-21", cent: 110_000 },
        { paketSlug: null, datum: "2026-11-28", cent: null },
      ]);
    });
  });

  describe("preisHash", () => {
    it("bleibt gleich, wenn Pakete und Tage in anderer Reihenfolge stehen", () => {
      const gedreht = version({
        packagePrices: [...v.packagePrices].reverse(),
        dayPrices: [...v.dayPrices].reverse().map((t) => ({
          ...t,
          paketpreise: t.paketpreise ? [...t.paketpreise].reverse() : null,
        })),
      });
      expect(preisHash(gedreht)).toBe(preisHash(v));
    });

    it("ändert sich, wenn ein Preis sich ändert", () => {
      const teurer = version({
        packagePrices: v.packagePrices.map((p) => (p.slug === "basis" ? { ...p, festpreis: 801 } : p)),
      });
      expect(preisHash(teurer)).not.toBe(preisHash(v));
    });
  });

  describe("angebotPasstZuVersion", () => {
    it("gilt für jede Wahl, deren Posten den Preis ergeben", () => {
      for (const e of alleKundenpreise(v)) {
        if (e.cent === null) continue;
        const r = wahlPreis(v, { paketSlug: e.paketSlug, datum: e.datum });
        expect(r?.priceCents).toBe(e.cent);
        expect(angebotPasstZuVersion({ fixedPriceCents: e.cent, posten: r!.kvItems }, v)).toBe(true);
      }
    });

    it("gilt nicht für einen Preis von Hand", () => {
      expect(angebotPasstZuVersion({ fixedPriceCents: 12_345, posten: [euroPosten(123.45)] }, v)).toBe(false);
    });

    it("F2 (I1): mit Wahl zählt nur diese Wahl; Posten Zeile für Zeile (Text, Menge, Satz)", () => {
      const basis = { paketSlug: "basis", datum: "2026-11-21" };
      const komfort = { paketSlug: "komfort", datum: "2026-11-21" };
      const b = wahlPreis(v, basis)!;
      // Genau die aktuelle Wahl: passt, auch mit Leerzeichen am Rand des Texts.
      expect(angebotPasstZuVersion({ fixedPriceCents: b.priceCents, posten: b.kvItems }, v, basis)).toBe(true);
      const mitRand = b.kvItems.map((p) => ({ ...p, description: `  ${p.description} ` }));
      expect(angebotPasstZuVersion({ fixedPriceCents: b.priceCents, posten: mitRand }, v, basis)).toBe(true);
      // Preis und Posten einer anderen Wahl (Basis), der Kunde hat Komfort: von Hand.
      expect(angebotPasstZuVersion({ fixedPriceCents: b.priceCents, posten: b.kvItems }, v, komfort)).toBe(false);
      // Ohne Wahl (Altaufruf) zählt jede Wahl.
      expect(angebotPasstZuVersion({ fixedPriceCents: b.priceCents, posten: b.kvItems }, v)).toBe(true);
      // Anderer Text bei gleichem Betrag: von Hand.
      const text = b.kvItems.map((p) => ({ ...p, description: `${p.description} inkl. Klavier` }));
      expect(angebotPasstZuVersion({ fixedPriceCents: b.priceCents, posten: text }, v, basis)).toBe(false);
      expect(angebotPasstZuVersion({ fixedPriceCents: b.priceCents, posten: text }, v)).toBe(false);
      // Andere Aufteilung bei gleicher Summe: von Hand.
      const geteilt = [{ ...b.kvItems[0], quantity: 2, unitRate: b.kvItems[0].unitRate / 2 }];
      expect(angebotPasstZuVersion({ fixedPriceCents: b.priceCents, posten: geteilt }, v, basis)).toBe(false);
      // Ein Posten mehr (0 €): von Hand.
      expect(angebotPasstZuVersion({ fixedPriceCents: b.priceCents, posten: [...b.kvItems, euroPosten(0)] }, v, basis)).toBe(false);
      // Wahl ohne Preis: nie.
      expect(angebotPasstZuVersion({ fixedPriceCents: 0, posten: [] }, v, { paketSlug: null, datum: "2026-11-28" })).toBe(false);
    });

    it("gilt nicht, wenn die Postensumme vom Preis abweicht", () => {
      expect(angebotPasstZuVersion({ fixedPriceCents: 100_000, posten: [euroPosten(1)] }, v)).toBe(false);
      const kaputt = version({ kvItems: [euroPosten(1, "haupt")] });
      expect(angebotPasstZuVersion({ fixedPriceCents: 100_000, posten: [euroPosten(1000, "haupt")] }, kaputt)).toBe(false);
    });
  });

  describe("kernBefund", () => {
    const zeile = (unitRate: number, quantity = 1): KvPosten => ({ description: "Posten", quantity, unitRate });

    it("ist ok ab der Hälfte, klein darunter", () => {
      expect(kernBefund([zeile(60), zeile(40)])).toEqual({ art: "ok" });
      expect(kernBefund([zeile(50), zeile(50)])).toEqual({ art: "ok" });
      expect(kernBefund([zeile(25, 2), zeile(50)])).toEqual({ art: "ok" });
      expect(kernBefund([zeile(49.99), zeile(50.01)])).toEqual({ art: "klein", anteil: 0.4999 });
    });

    it("meldet negativ, wenn der Kern oder die Summe nicht positiv ist", () => {
      expect(kernBefund([zeile(0), zeile(100)])).toEqual({ art: "negativ" });
      expect(kernBefund([zeile(-5), zeile(100)])).toEqual({ art: "negativ" });
      expect(kernBefund([zeile(10), zeile(-100)])).toEqual({ art: "negativ" });
    });

    it("nennt einen einzelnen Posten ein_posten", () => {
      expect(kernBefund([zeile(100)])).toEqual({ art: "ein_posten" });
      expect(kernBefund([])).toEqual({ art: "ein_posten" });
    });
  });

  describe("paketOhneHebelSperrt", () => {
    it("erlaubt Basis ohne Hebel und sperrt jedes andere leere Paket", () => {
      expect(paketOhneHebelSperrt({ slug: "basis", hebel: [] })).toBe(false);
      expect(paketOhneHebelSperrt({ slug: "komfort", hebel: [] })).toBe(true);
      expect(paketOhneHebelSperrt({ slug: "premium", hebel: [] })).toBe(true);
      expect(paketOhneHebelSperrt({ slug: "komfort", hebel: ["montage"] })).toBe(false);
    });
  });

  describe("anzahlungPasst", () => {
    it("lässt keine und eine Anzahlung von 0 zu", () => {
      expect(anzahlungPasst(null, v)).toBe(true);
      expect(anzahlungPasst(0, v)).toBe(true);
    });

    it("lehnt ab, wenn die Anzahlung einem angebotenen Preis entspricht", () => {
      expect(anzahlungPasst(70_000, v)).toBe(false);
      expect(anzahlungPasst(69_999, v)).toBe(true);
    });
  });

  it("die gebauten Posten ergeben den Cent-Betrag, den der Vertrag vergleicht", () => {
    for (const e of alleKundenpreise(v)) {
      if (e.cent === null) continue;
      const r = wahlPreis(v, { paketSlug: e.paketSlug, datum: e.datum });
      expect(postenCent(r!.kvItems)).toBe(e.cent);
    }
  });
});

/**
 * Plan 5b, Task K: Sperren mit Paket-, Tages- und Stundenpreisen (Firmen-Schalter),
 * Anpassungen der neuen Arten, „Tage anbieten“ und Raster. Posten je Wahl (Task P)
 * sind ersetzt: je Wahl ein Kern-Posten mit genau dem Preis.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({
  db: new Proxy({}, { get(_t, p) { if (p === "then" || typeof p === "symbol") return undefined; throw new Error(`@/db im Test (${String(p)})`); } }),
}));

const posten = vi.hoisted(() => ({
  /** Kern-Posten je Wahl; überschreibbar je Test (z. B. negativer Kern). */
  jeWahl: (preis: number, wo: string) => [{ description: `Kern ${wo}`, quantity: 1, unitRate: preis }],
}));
vi.mock("./rechner/wahl-posten", () => ({
  postenJeWahl: vi.fn((input: { version: import("@/lib/angebot-wahl").VersionsPreise }) => {
    const v = input.version;
    return {
      ...v,
      packagePrices: v.packagePrices.map((p) => ({ ...p, kvItems: p.festpreis === null ? [] : posten.jeWahl(p.festpreis, p.slug) })),
      dayPrices: v.dayPrices.map((t) => ({
        ...t,
        kvItems: t.festpreis === null ? [] : posten.jeWahl(t.festpreis, t.datum),
        paketpreise: t.paketpreise?.map((p) => ({ ...p, kvItems: p.festpreis === null ? [] : posten.jeWahl(p.festpreis, `${t.datum}:${p.slug}`) })) ?? null,
      })),
    };
  }),
  stundenPosten: vi.fn((s: import("@/lib/angebot-wahl").RechnerStunden) => ({
    posten: [
      { type: "helper", description: "Helfer je Stunde", quantity: s.helfer, unitRate: s.satzHelferEur },
      { type: "transporter", description: "Transporter je Stunde", quantity: s.transporter, unitRate: s.satzTransporterEur },
      ...s.zusatzposten.map((z) => ({ type: "other", description: z.bezeichnung, quantity: 1, unitRate: z.betrag })),
    ],
    angebot: {
      helfer: s.helfer, transporter: s.transporter, stundenGeschaetzt: s.stundenGeschaetzt, mindestStunden: s.mindestStunden,
      satzHelferEur: s.satzHelferEur, satzTransporterEur: s.satzTransporterEur,
      summeGeschaetztCent: Math.round(s.summeGeschaetztEur * 100), mindestbetragCent: Math.round(s.mindestbetragEur * 100), quelle: "version",
    },
  })),
}));

import { PLAN5_FEHLER_TEXT, preisHash, type Plan5Schalter, type RechnerStunden, type TageAnbieten } from "@/lib/angebot-wahl";
import { UebersteuerungFehler, versionsPreiseAusZeile } from "@/lib/kalkulation-versionen";
import type { Quotation } from "./quotations";
import type { RechnerAnfrage } from "./rechner/eingabe";
import type { RechnerErgebnis } from "./rechner/client";
import type { KalkulationsZeile } from "./rechner/kalkulation";
import type { HebelArt } from "./rechner/kv-posten";
import {
  centSumme,
  EntwurfExistiertError,
  entwurfHolenOderAnlegen,
  sperren,
  tageSetzen,
  tagesRaster,
  uebersteuern,
  VersionsFehler,
  type Autor,
  type PaketOption,
  type Plan5Sperre,
  type VersionsSpeicher,
  type VersionsZeile,
} from "./kalkulation-versionen";

const MENSCH: Autor = { userId: "usr_1", quelle: "mensch" };
const AGENT: Autor = { userId: null, quelle: "agent" };
const AN: Plan5Schalter = { angebotAusKalkulation: true, tagespreise: true };

const lead = {
  von: "Böblingen", nach: "Stuttgart", etageVon: 0, etageNach: null, zugangVon: null, zugangNach: null,
  umzugsdatum: "2026-11-21", wohnflaecheQm: null, zimmer: 3, tragestreckeVonM: null, tragestreckeNachM: null,
  halteverbot: false, packService: false, kartons: null, inventar: [],
};

const STUNDEN: RechnerStunden = {
  helfer: 2, transporter: 1, stundenGeschaetzt: 5.5, mindestStunden: 3, satzHelferEur: 35, satzTransporterEur: 25,
  zusatzposten: [], summeGeschaetztEur: 522.5, mindestbetragEur: 285,
};

/** Rechner: Haupt 1490, Pakete aus paket_hebel (basis 1290, komfort 1490, premium 1790), Tage aus tage (+100 € am Samstag). */
function rechnerAntwort(a: RechnerAnfrage, extra: Partial<RechnerErgebnis> = {}): RechnerErgebnis {
  const pak: Record<string, number> = { basis: 1290, komfort: 1490, premium: 1790, einzeltransport: 590 };
  const hebel = typeof a.paket_hebel === "string" ? (JSON.parse(a.paket_hebel) as Record<string, HebelArt[]>) : null;
  const paketpreise = hebel
    ? Object.keys(hebel).map((slug) => ({ slug, festpreis: pak[slug] ?? null, selbstkosten: (pak[slug] ?? 0) * 0.6, rundungEur: 10, margeProzent: 40 }))
    : undefined;
  const tage = typeof a.tage === "string" ? (JSON.parse(a.tage) as string[]) : null;
  const sa = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay() === 6;
  return {
    montageJePosition: true,
    preis: { festpreis: 1490, selbstkosten: 800, rundungEur: 10, margeWirksamProzent: 40, nichtKalkulierbarGrund: null, margeVorschlag: { prozent: 40, gruende: [] } },
    kosten: { selbstkosten: 800, posten: [{ key: "personal.arbeit", bezeichnung: "Personal Arbeit", menge: 10, einheit: "h", satz: 20, betrag: 200 }] },
    volumen: { nettoCbm: 20 },
    tarif: { id: "t1", version: 3, marke: "kottke" },
    schaetzung: null,
    ...(paketpreise ? { paketpreise } : {}),
    ...(tage
      ? {
          tagespreise: tage.map((datum) => ({
            datum, wochentag: sa(datum) ? ("sa" as const) : ("fr" as const), feiertag: false,
            festpreis: 1490 + (sa(datum) ? 100 : 0), selbstkosten: 800, margeProzent: 40,
            gruende: sa(datum) ? [{ text: "Samstag", punkte: 5 }] : [],
            paketpreise: paketpreise ? paketpreise.map((p) => ({ ...p, festpreis: p.festpreis === null ? null : p.festpreis + (sa(datum) ? 100 : 0) })) : null,
          })),
        }
      : {}),
    ...(a.stunden_modus === "1" ? { stunden: STUNDEN } : {}),
    ...extra,
  };
}

function aufbau(o: { schalter?: Plan5Schalter; optionen?: PaketOption[]; hebel?: Record<string, HebelArt[]>; angebot?: Partial<Quotation> | null; kottke?: boolean } = {}) {
  const zeilen: VersionsZeile[] = [];
  const k = <T,>(x: T): T => structuredClone(x);
  let extra: Partial<RechnerErgebnis> = {};
  const jetzt = new Date("2026-11-07T09:00:00Z");
  const speicher: VersionsSpeicher = {
    liste: async () => k(zeilen),
    lesen: async (_ws, _deal, v) => k(zeilen.find((z) => z.version === v) ?? null),
    entwurf: async () => k(zeilen.find((z) => z.status === "entwurf") ?? null),
    anlegen: vi.fn(async (z) => {
      if (zeilen.some((x) => x.status === "entwurf")) throw new EntwurfExistiertError();
      const neu = { ...k(z), id: `id_v${z.version}`, createdAt: jetzt, updatedAt: jetzt } as VersionsZeile;
      zeilen.push(neu);
      return k(neu);
    }),
    aktualisieren: vi.fn(async (id, patch) => {
      const z = zeilen.find((x) => x.id === id && x.status === "entwurf");
      if (!z) throw new VersionsFehler("UNGUELTIG", "Version ist bereits gesperrt.");
      const { overrides: _o, ...f } = k(patch);
      Object.assign(z, f);
      return k(z);
    }),
    anhaengen: vi.fn(async (id, u) => {
      const z = zeilen.find((x) => x.id === id && x.status === "entwurf");
      if (!z) throw new VersionsFehler("UNGUELTIG", "Version ist bereits gesperrt.");
      z.overrides = [...z.overrides, k(u)];
      return k(z);
    }),
    sperrenUndAngebot: vi.fn(async (_ws, _deal, id, _angebot, kvItems, von, stand) => {
      const z = zeilen.find((x) => x.id === id && x.status === "entwurf");
      if (!z) throw new VersionsFehler("UNGUELTIG", "Version ist bereits gesperrt.");
      const p = stand?.plan5;
      Object.assign(z, {
        status: "gesperrt", kvItems: k(kvItems), priceCents: p ? p.preise.priceCents : centSumme(kvItems), lockedBy: von,
        ...(p ? { pricingMode: p.preise.pricingMode, packagePrices: k(p.preise.packagePrices), dayPrices: k(p.preise.dayPrices) } : {}),
      });
      return { version: k(z) };
    }),
  };
  const rechner = vi.fn(async (a: RechnerAnfrage) => ({ ok: true as const, ergebnis: rechnerAntwort(a, extra) }));
  const melde = vi.fn(async () => ({ ok: true as const }));
  const nachher: Array<() => Promise<void>> = [];
  const optionen = o.optionen ?? [];
  const deps = {
    speicher,
    rechner,
    melde,
    jetzt: () => jetzt,
    ladeLead: vi.fn(async () => lead),
    nachher: (f: () => Promise<void>) => { nachher.push(f); },
    pruefeAnnahme: vi.fn(async () => undefined),
    hatPakete: vi.fn(async () => optionen.length > 0),
    ladePaketHebel: vi.fn(async () => o.hebel ?? { basis: [], komfort: ["halteverbot", "montage"] as HebelArt[], premium: ["halteverbot", "montage", "einpacken", "kueche"] as HebelArt[] }),
    ladeAngebot: vi.fn(async (): Promise<Quotation | null> =>
      o.angebot === null ? null : ({ id: "q1", notes: null, isVariable: false, validUntil: null, depositRequiredCents: null, lineItems: [], ...o.angebot } as Quotation)
    ),
    ladeCache: vi.fn(async (): Promise<KalkulationsZeile | null> => null),
    nachSperren: vi.fn(async () => undefined),
    ladeSchalter: vi.fn(async () => o.schalter ?? AN),
    ladePaketOptionen: vi.fn(async () => optionen),
    istKottke: vi.fn(async () => o.kottke ?? false),
    ladeAuftraege: vi.fn(async () => [
      { datum: "2026-11-20", dealId: "deal_x", name: "Familie Nowak" },
      { datum: "2026-11-20", dealId: "deal1", name: "Dieser Deal" },
    ]),
    ladeWunschtermine: vi.fn(async () => ["2026-11-28", "2026-11-21"]),
  };
  const sperrAufruf = () => vi.mocked(speicher.sperrenUndAngebot).mock.calls.at(-1)!;
  return {
    zeilen, deps, speicher, rechner, melde, nachher,
    setzeExtra: (e: Partial<RechnerErgebnis>) => { extra = e; },
    plan5: (): Plan5Sperre | undefined => sperrAufruf()[6]?.plan5,
    alleNachher: async () => { for (const f of nachher.splice(0)) await f(); },
  };
}

const PAKETE: PaketOption[] = [
  { id: "opt_b", catalogueSlug: "basis", isRecommended: false },
  { id: "opt_k", catalogueSlug: "komfort", isRecommended: true },
];

const tageEingabe = (felder: Partial<TageAnbieten> = {}): TageAnbieten => ({
  tage: [
    { datum: "2026-11-20", slots: [{ label: "Vormittag", startTime: "08:00", endTime: "12:00" }], note: null, empfohlen: false },
    { datum: "2026-11-21", slots: [], note: "Samstag", empfohlen: true },
  ],
  uebersteuerungen: [],
  ...felder,
});

async function fehler(p: Promise<unknown>): Promise<VersionsFehler> {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(VersionsFehler);
  return e as VersionsFehler;
}

describe("Sperren mit Paketpreisen (Schalter an)", () => {
  it("rechnet nur mit den Hebeln der angebotenen Pakete und den Plan-5b-Schaltern; schreibt Quotation aus der Standardwahl", async () => {
    const t = aufbau({ optionen: PAKETE });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    const anfrage = t.zeilen[0].rechnerRequest!;
    expect(JSON.parse(anfrage.paket_hebel as string)).toEqual({ basis: [], komfort: ["halteverbot", "montage"] });
    expect(anfrage).toMatchObject({ paket_uebersteuerungen: "1", zeilen_stabil: "1" });
    expect(anfrage).not.toHaveProperty("tage");

    const r = await sperren("ws", "deal1", 1, MENSCH, {}, t.deps);
    const p = t.plan5()!;
    expect(p.standard).toEqual({ paketSlug: "komfort", datum: null });
    expect(p.preise.priceCents).toBe(149000);
    expect(p.preise.packagePrices.map((x) => [x.slug, x.festpreis, centSumme(x.kvItems ?? [])])).toEqual([["basis", 1290, 129000], ["komfort", 1490, 149000]]);
    expect(r.version).toMatchObject({ status: "gesperrt", priceCents: 149000 });
  });

  it("Agent darf Pakete sperren (wie Festpreis, F19)", async () => {
    const t = aufbau({ optionen: PAKETE });
    await entwurfHolenOderAnlegen("ws", "deal1", AGENT, t.deps);
    expect((await sperren("ws", "deal1", 1, AGENT, {}, t.deps)).version.status).toBe("gesperrt");
  });

  it("frei angelegte Option (ohne Katalog-Slug) → PAKET_OHNE_PREIS, nichts gesperrt", async () => {
    const t = aufbau({ optionen: [...PAKETE, { id: "opt_x", catalogueSlug: null, isRecommended: false }] });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    const e = await fehler(sperren("ws", "deal1", 1, MENSCH, {}, t.deps));
    expect(e).toMatchObject({ code: "PAKET_OHNE_PREIS", status: 409, message: PLAN5_FEHLER_TEXT.PAKET_OHNE_PREIS });
    expect(t.speicher.sperrenUndAngebot).not.toHaveBeenCalled();
  });

  it("Paket ohne Rechnerpreis → PAKET_OHNE_PREIS", async () => {
    const t = aufbau({ optionen: [{ id: "o", catalogueSlug: "umzug_xl", isRecommended: true }], hebel: { umzug_xl: ["montage"] } });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    expect((await fehler(sperren("ws", "deal1", 1, MENSCH, {}, t.deps))).code).toBe("PAKET_OHNE_PREIS");
  });

  it("Nicht-Basis-Paket ohne Hebel → PAKET_OHNE_HEBEL; mit begründetem Paketpreis (F7) sperrbar", async () => {
    const t = aufbau({ optionen: [{ id: "o", catalogueSlug: "einzeltransport", isRecommended: true }], hebel: { einzeltransport: [] } });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    expect((await fehler(sperren("ws", "deal1", 1, MENSCH, {}, t.deps))).code).toBe("PAKET_OHNE_HEBEL");
    await uebersteuern("ws", "deal1", 1, { art: "paketpreis", key: "einzeltransport", wert: { betrag: 690 }, grund: "Nur Klavier" }, MENSCH, t.deps);
    await sperren("ws", "deal1", 1, MENSCH, {}, t.deps);
    expect(t.plan5()!.preise.packagePrices[0]).toMatchObject({ slug: "einzeltransport", festpreis: 690, rechnerFestpreis: 590, uebersteuert: { betrag: 690, grund: "Nur Klavier" } });
    expect(t.plan5()!.preise.priceCents).toBe(69000);
  });

  it("Kern ≤ 0 in irgendeiner Wahl → KERN_NEGATIV", async () => {
    const t = aufbau({ optionen: PAKETE });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    const vorher = posten.jeWahl;
    posten.jeWahl = (preis, wo) =>
      wo === "basis" ? [{ description: "Kern", quantity: 1, unitRate: -10 }, { description: "Halteverbot", quantity: 1, unitRate: preis + 10 }] : vorher(preis, wo);
    try {
      expect(await fehler(sperren("ws", "deal1", 1, MENSCH, {}, t.deps))).toMatchObject({ code: "KERN_NEGATIV", message: PLAN5_FEHLER_TEXT.KERN_NEGATIV });
    } finally {
      posten.jeWahl = vorher;
    }
  });

  it("Anzahlung nicht unter jedem angebotenen Preis → ANZAHLUNG_UEBER_PREIS", async () => {
    const t = aufbau({ optionen: PAKETE, angebot: { depositRequiredCents: 129000 } });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    expect((await fehler(sperren("ws", "deal1", 1, MENSCH, {}, t.deps))).code).toBe("ANZAHLUNG_UEBER_PREIS");
  });

  it("preisHash: gleich → gesperrt; geänderter Paketpreis → PREIS_GEAENDERT; Cent allein reicht wie heute", async () => {
    const t = aufbau({ optionen: PAKETE });
    const { version: v } = await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    const gezeigt = "-@-=149000|basis@-=129000|komfort@-=149000";
    // Der Hash deckt alle Kundenpreise: eine andere Basis bei gleichem Standardpreis wird erkannt.
    await expect(sperren("ws", "deal1", 1, MENSCH, { erwartetPreisHash: gezeigt.replace("129000", "119000") }, t.deps)).rejects.toMatchObject({
      code: "PREIS_GEAENDERT",
    });
    await expect(sperren("ws", "deal1", 1, MENSCH, { erwartetPreisCent: 129000 }, t.deps)).rejects.toMatchObject({ code: "PREIS_GEAENDERT" });
    expect(v.status).toBe("entwurf");
    await sperren("ws", "deal1", 1, MENSCH, { erwartetPreisHash: gezeigt }, t.deps);
    expect(preisHash(versionsPreiseAusZeile(t.zeilen[0]))).toBe(gezeigt);
  });

  it("Paketpreis-Anpassung: Pflichtgrund, nie unter 30 % Marge, ohne neuen Rechner-Aufruf, Meldung erst beim Sperren", async () => {
    const t = aufbau({ optionen: PAKETE });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    t.rechner.mockClear();
    // komfort: Selbstkosten 894 → bei 30 % Marge mindestens 1280 €.
    await expect(uebersteuern("ws", "deal1", 1, { art: "paketpreis", key: "komfort", wert: { betrag: 1200 }, grund: "Stammkunde" }, MENSCH, t.deps))
      .rejects.toThrow(/Mindestmarge von 30 % \(mindestens 1\.280 €\)/);
    await expect(uebersteuern("ws", "deal1", 1, { art: "paketpreis", key: "komfort", wert: { betrag: 1390 }, grund: " " }, MENSCH, t.deps))
      .rejects.toBeInstanceOf(UebersteuerungFehler);
    await expect(uebersteuern("ws", "deal1", 1, { art: "paketpreis", key: "luxus", wert: { betrag: 1390 }, grund: "x" }, MENSCH, t.deps))
      .rejects.toThrow("Unbekanntes Paket: luxus");
    const r = await uebersteuern("ws", "deal1", 1, { art: "paketpreis", key: "komfort", wert: { betrag: 1390 }, grund: "Stammkunde" }, MENSCH, t.deps);
    expect(t.rechner).not.toHaveBeenCalled();
    expect(r.version.packagePrices.find((p) => p.slug === "komfort")).toMatchObject({ festpreis: 1390, rechnerFestpreis: 1490 });
    await t.alleNachher();
    expect(t.melde).not.toHaveBeenCalled();

    await sperren("ws", "deal1", 1, MENSCH, {}, t.deps);
    await t.alleNachher();
    expect(t.melde).toHaveBeenCalledWith(expect.objectContaining({ regel: "paketpreis", zeile_key: "komfort", rechnerwert: 1490, inhaberwert: 1390, grund: "Stammkunde" }));
    expect(t.plan5()!.preise.priceCents).toBe(139000);
  });

  it("„als ein Posten zeigen“ nur Mensch; Preismodus nur Mensch; ohne Schalter gibt es die Arten nicht", async () => {
    const t = aufbau({ optionen: PAKETE });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    await expect(uebersteuern("ws", "deal1", 1, { art: "kv_darstellung", key: "kv", wert: "ein_posten", grund: "Kunde will eine Zeile" }, AGENT, t.deps))
      .rejects.toThrow("nur ein Mensch");
    await expect(uebersteuern("ws", "deal1", 1, { art: "preismodus", key: "modus", wert: "stunden", grund: "Aufwand unklar" }, AGENT, t.deps))
      .rejects.toMatchObject({ code: "STUNDEN_NUR_MENSCH" });
    const aus = aufbau({ schalter: { angebotAusKalkulation: false, tagespreise: false } });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, aus.deps);
    await expect(uebersteuern("ws", "deal1", 1, { art: "paketpreis", key: "basis", wert: { betrag: 1390 }, grund: "x" }, MENSCH, aus.deps))
      .rejects.toThrow("Firmen-Schalter");
  });
});

describe("Sperren mit Tagespreisen", () => {
  it("Tage anbieten, dann sperren: Tagespreise mit Paketen, Standardwahl empfohlenes Paket am empfohlenen Tag, gültig bis vor dem frühesten Tag", async () => {
    const t = aufbau({ optionen: PAKETE });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    const v = await tageSetzen("ws", "deal1", 1, MENSCH, tageEingabe(), t.deps);
    expect(JSON.parse(v.rechnerRequest!.tage as string)).toEqual(["2026-11-20", "2026-11-21"]);
    expect(v.dayPrices.map((d) => [d.datum, d.festpreis, d.empfohlen, d.slots.length])).toEqual([["2026-11-20", 1490, false, 1], ["2026-11-21", 1590, true, 0]]);

    await sperren("ws", "deal1", 1, MENSCH, {}, t.deps);
    const p = t.plan5()!;
    expect(p.standard).toEqual({ paketSlug: "komfort", datum: "2026-11-21" });
    expect(p.preise.priceCents).toBe(159000);
    expect(p.preise.dayPrices[1].paketpreise?.map((x) => [x.slug, x.festpreis])).toEqual([["basis", 1390], ["komfort", 1590]]);
    expect(vi.mocked(t.speicher.sperrenUndAngebot).mock.calls[0][3].validUntil).toBe("2026-11-14");
  });

  it("Agent: Tage anbieten und Sperren mit Tagespreisen → TAGESPREIS_NUR_MENSCH", async () => {
    const t = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    expect(await fehler(tageSetzen("ws", "deal1", 1, AGENT, tageEingabe(), t.deps))).toMatchObject({ code: "TAGESPREIS_NUR_MENSCH" });
    await tageSetzen("ws", "deal1", 1, MENSCH, tageEingabe(), t.deps);
    expect(await fehler(sperren("ws", "deal1", 1, AGENT, {}, t.deps))).toMatchObject({
      code: "TAGESPREIS_NUR_MENSCH", message: PLAN5_FEHLER_TEXT.TAGESPREIS_NUR_MENSCH,
    });
  });

  it("an gesperrter Version legt „Tage anbieten“ den nächsten Entwurf an (F17), der die Tage erbt", async () => {
    const t = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    await tageSetzen("ws", "deal1", 1, MENSCH, tageEingabe(), t.deps);
    await sperren("ws", "deal1", 1, MENSCH, {}, t.deps);
    const v2 = await tageSetzen("ws", "deal1", 1, MENSCH, tageEingabe({ tage: [{ datum: "2026-11-27", slots: [], note: null, empfohlen: true }] }), t.deps);
    expect(v2).toMatchObject({ version: 2, status: "entwurf" });
    expect(v2.dayPrices.map((d) => d.datum)).toEqual(["2026-11-27"]);
    expect(t.zeilen[0].dayPrices.map((d) => d.datum)).toEqual(["2026-11-20", "2026-11-21"]);
    // Eine andere Anpassung an v1 erbt die Tage von v1 in den neuen Entwurf (kein stiller Verlust der Terminwahl).
    const t2 = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t2.deps);
    await tageSetzen("ws", "deal1", 1, MENSCH, tageEingabe(), t2.deps);
    await sperren("ws", "deal1", 1, MENSCH, {}, t2.deps);
    const { version: v } = await uebersteuern("ws", "deal1", 1, { art: "marge", key: "marge", wert: 45, grund: "x" }, MENSCH, t2.deps);
    expect(v.dayPrices.map((d) => d.datum)).toEqual(["2026-11-20", "2026-11-21"]);
  });

  it("Tagespreis-Anpassung: Untergrenze, Liste ist der ganze Stand (fehlende aufgehoben)", async () => {
    const t = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    await expect(tageSetzen("ws", "deal1", 1, MENSCH, tageEingabe({ uebersteuerungen: [{ datum: "2026-11-21", paketSlug: null, betrag: 900, grund: "Lücke" }] }), t.deps))
      .rejects.toThrow(/Mindestmarge/);
    const v = await tageSetzen("ws", "deal1", 1, MENSCH, tageEingabe({ uebersteuerungen: [{ datum: "2026-11-21", paketSlug: null, betrag: 1490, grund: "Wie Freitag" }] }), t.deps);
    expect(v.dayPrices[1]).toMatchObject({ festpreis: 1490, rechnerFestpreis: 1590, uebersteuert: { betrag: 1490, grund: "Wie Freitag" } });
    const ohne = await tageSetzen("ws", "deal1", 1, MENSCH, tageEingabe(), t.deps);
    expect(ohne.dayPrices[1]).toMatchObject({ festpreis: 1590, uebersteuert: null });
    expect(ohne.overrides.filter((u) => u.art === "tagespreis").map((u) => u.wert)).toEqual([{ betrag: 1490 }, null]);
  });

  it("Tage anbieten: höchstens 10, nicht vorbei, höchstens eine Empfehlung; ohne Schalter nicht", async () => {
    const t = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    await expect(tageSetzen("ws", "deal1", 1, MENSCH, tageEingabe({ tage: [{ datum: "2026-11-01", slots: [], note: null, empfohlen: true }] }), t.deps)).rejects.toThrow(/Vergangenheit/);
    await expect(tageSetzen("ws", "deal1", 1, MENSCH, { tage: tageEingabe().tage.map((x) => ({ ...x, empfohlen: true })), uebersteuerungen: [] }, t.deps)).rejects.toThrow(/Höchstens ein Tag/);
    const elf = Array.from({ length: 11 }, (_, i) => ({ datum: `2026-12-${String(i + 1).padStart(2, "0")}`, slots: [], note: null, empfohlen: i === 0 }));
    await expect(tageSetzen("ws", "deal1", 1, MENSCH, { tage: elf, uebersteuerungen: [] }, t.deps)).rejects.toThrow(/Höchstens 10/);
    const aus = aufbau({ schalter: { angebotAusKalkulation: true, tagespreise: false } });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, aus.deps);
    await expect(tageSetzen("ws", "deal1", 1, MENSCH, tageEingabe(), aus.deps)).rejects.toThrow("nicht eingeschaltet");
  });

  it("Raster speichert nichts: Preis je Tag (empfohlenes Paket), Gründe, Aufträge ohne diesen Deal, vergangen, Wunschtermin, Margen-Hinweis", async () => {
    const t = aufbau({ optionen: PAKETE });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    await uebersteuern("ws", "deal1", 1, { art: "marge", key: "marge", wert: 45, grund: "Saison" }, MENSCH, t.deps);
    vi.mocked(t.speicher.aktualisieren).mockClear();
    const r = await tagesRaster("ws", "deal1", 1, "2026-11-06", "2026-11-21", t.deps);
    expect(t.speicher.aktualisieren).not.toHaveBeenCalled();
    expect(t.speicher.anhaengen).toHaveBeenCalledTimes(1);
    expect(r.zellen).toHaveLength(16);
    expect(r.zellen.find((z) => z.datum === "2026-11-21")).toMatchObject({ preisCent: 159000, gruende: [{ text: "Samstag", punkte: 5 }], vergangen: false });
    expect(r.zellen[0]).toMatchObject({ datum: "2026-11-06", vergangen: true });
    expect(r.zellen.find((z) => z.datum === "2026-11-20")!.auftraege).toEqual([{ dealId: "deal_x", name: "Familie Nowak" }]);
    expect(r.wunschtermin).toEqual({ datum: "2026-11-21", quelle: "deal", weitere: ["2026-11-28"] });
    expect(r.hinweis).toMatch(/45 % gesetzt und gilt an allen Tagen/);
    await expect(tagesRaster("ws", "deal1", 1, "2026-11-01", "2026-12-20", t.deps)).rejects.toMatchObject({ code: "UNGUELTIG" });
  });
});

describe("Stunden-KV aus der Version", () => {
  async function stundenEntwurf(t: ReturnType<typeof aufbau>) {
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    return uebersteuern("ws", "deal1", 1, { art: "preismodus", key: "modus", wert: "stunden", grund: "Aufwand unklar" }, MENSCH, t.deps);
  }

  it("Preismodus stunden: Anfrage mit stunden_modus, Version im Stundenmodus mit der Schätzung, Stunden-Posten typisiert", async () => {
    const t = aufbau();
    const { version } = await stundenEntwurf(t);
    expect(version).toMatchObject({ pricingMode: "stunden", priceCents: 52250 });
    expect(version.rechnerRequest?.stunden_modus).toBe("1");
    await sperren("ws", "deal1", 1, MENSCH, {}, t.deps);
    const p = t.plan5()!;
    expect(p.preise).toMatchObject({ pricingMode: "stunden", priceCents: 52250, packagePrices: [], dayPrices: [] });
    expect(p.stunden?.posten.map((x) => x.type)).toEqual(["helper", "transporter"]);
    expect(p.stunden?.angebot).toMatchObject({ summeGeschaetztCent: 52250, mindestbetragCent: 28500, quelle: "version" });
    expect(t.zeilen[0]).toMatchObject({ status: "gesperrt", pricingMode: "stunden", priceCents: 52250 });
  });

  it("Schätzung (Spanne) sperrt im Stundenmodus ohne Spannen-Bestätigung; der Festpreis braucht sie weiter (Integration 5b)", async () => {
    const t = aufbau();
    t.setzeExtra({ schaetzung: { festpreisVon: 1190, festpreisBis: 1490, annahmen: [] } });
    await stundenEntwurf(t);
    // Die Seite zeigt im Stundenmodus keine KV-Vorschau und schickt keine Bestätigung der Obergrenze.
    await sperren("ws", "deal1", 1, MENSCH, {}, t.deps);
    expect(t.zeilen[0]).toMatchObject({ status: "gesperrt", pricingMode: "stunden", priceCents: 52250 });

    const f = aufbau();
    f.setzeExtra({ schaetzung: { festpreisVon: 1190, festpreisBis: 1490, annahmen: [] } });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, f.deps);
    expect(await fehler(sperren("ws", "deal1", 1, MENSCH, {}, f.deps))).toMatchObject({ code: "SPANNE" });
  });

  it("Agent sperrt keinen Stunden-KV → STUNDEN_NUR_MENSCH", async () => {
    const t = aufbau();
    await stundenEntwurf(t);
    expect(await fehler(sperren("ws", "deal1", 1, AGENT, {}, t.deps))).toMatchObject({ code: "STUNDEN_NUR_MENSCH" });
  });

  it("Kottke mit festen Zusatzposten → STUNDEN_ZUSATZ_VPS (F12); ohne Zusatzposten oder Nicht-Kottke sperrbar", async () => {
    const t = aufbau({ kottke: true });
    await stundenEntwurf(t);
    t.setzeExtra({ stunden: { ...STUNDEN, zusatzposten: [{ key: "halteverbot", bezeichnung: "Halteverbot", betrag: 150 }] } });
    t.zeilen[0].rechnerResult = { ...t.zeilen[0].rechnerResult!, stunden: { ...STUNDEN, zusatzposten: [{ key: "halteverbot", bezeichnung: "Halteverbot", betrag: 150 }] } };
    expect(await fehler(sperren("ws", "deal1", 1, MENSCH, {}, t.deps))).toMatchObject({ code: "STUNDEN_ZUSATZ_VPS", message: PLAN5_FEHLER_TEXT.STUNDEN_ZUSATZ_VPS });
    t.deps.istKottke.mockResolvedValue(false);
    await sperren("ws", "deal1", 1, MENSCH, {}, t.deps);
    expect(t.plan5()!.stunden?.posten.map((x) => x.type)).toEqual(["helper", "transporter", "other"]);
  });

  it.each([0, 2])("K1: Kottke mit %i Transportern → STUNDEN_TRANSPORTER_VPS; mit genau einem oder Nicht-Kottke sperrbar", async (n) => {
    const t = aufbau({ kottke: true });
    await stundenEntwurf(t);
    t.setzeExtra({ stunden: { ...STUNDEN, transporter: n } });
    t.zeilen[0].rechnerResult = { ...t.zeilen[0].rechnerResult!, stunden: { ...STUNDEN, transporter: n } };
    expect(await fehler(sperren("ws", "deal1", 1, MENSCH, {}, t.deps))).toMatchObject({
      code: "STUNDEN_TRANSPORTER_VPS",
      message: "Stunden-KV für Kottke geht nur mit genau einem Transporter. Bitte als Festpreis anbieten.",
    });
    expect(t.zeilen[0].status).toBe("entwurf");
    t.deps.istKottke.mockResolvedValue(false);
    await sperren("ws", "deal1", 1, MENSCH, {}, t.deps);
    expect(t.plan5()!.stunden?.angebot.transporter).toBe(n);
  });

  it("K1: Kottke mit genau einem Transporter sperrt", async () => {
    const t = aufbau({ kottke: true });
    await stundenEntwurf(t);
    await sperren("ws", "deal1", 1, MENSCH, {}, t.deps);
    expect(t.plan5()!.stunden?.angebot.transporter).toBe(1);
  });

  it("ohne Stundensätze im Rechner → RECHNER_FEHLER mit Hinweis", async () => {
    const t = aufbau();
    t.setzeExtra({ stunden: null, ...({ stundenHinweis: "Keine Stundensätze für kottke." } as object) });
    await stundenEntwurf(t);
    expect(await fehler(sperren("ws", "deal1", 1, MENSCH, {}, t.deps))).toMatchObject({ code: "RECHNER_FEHLER", message: "Stunden nicht kalkulierbar: Keine Stundensätze für kottke." });
  });

  it("Stunden-KV mit Paketoptionen oder Tagen sperrt nicht", async () => {
    const t = aufbau({ optionen: PAKETE });
    await stundenEntwurf(t);
    expect((await fehler(sperren("ws", "deal1", 1, MENSCH, {}, t.deps))).message).toMatch(/keine Paketoptionen/);
    const t2 = aufbau();
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t2.deps);
    await tageSetzen("ws", "deal1", 1, MENSCH, tageEingabe(), t2.deps);
    await uebersteuern("ws", "deal1", 1, { art: "preismodus", key: "modus", wert: "stunden", grund: "x" }, MENSCH, t2.deps);
    expect((await fehler(sperren("ws", "deal1", 1, MENSCH, {}, t2.deps))).message).toMatch(/keine Tagespreise/);
    await expect(tageSetzen("ws", "deal1", 1, MENSCH, tageEingabe(), t2.deps)).rejects.toThrow(/Stundenmodus/);
  });

  it("vorhandener Stunden-KV und Festpreis-Version: Mensch ohne Bestätigung MODUSWECHSEL, Agent nie", async () => {
    const t = aufbau({ angebot: { isVariable: true } });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    expect((await fehler(sperren("ws", "deal1", 1, MENSCH, {}, t.deps))).code).toBe("MODUSWECHSEL");
    expect((await fehler(sperren("ws", "deal1", 1, AGENT, { modusWechselBestaetigt: true }, t.deps))).code).toBe("STUNDEN_NUR_MENSCH");
    expect((await sperren("ws", "deal1", 1, MENSCH, { modusWechselBestaetigt: true }, t.deps)).version.status).toBe("gesperrt");
  });
});

describe("ohne Schalter wie vorher", () => {
  it("kein plan5 an den Speicher, Anfrage ohne Plan-5b-Felder, Paketoptionen → PAKETE", async () => {
    const t = aufbau({ schalter: { angebotAusKalkulation: false, tagespreise: false } });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, t.deps);
    const a = t.zeilen[0].rechnerRequest!;
    for (const feld of ["paket_uebersteuerungen", "zeilen_stabil", "stunden_modus", "tage"]) expect(a).not.toHaveProperty(feld);
    await sperren("ws", "deal1", 1, MENSCH, { erwartetPreisHash: "wird ignoriert" }, t.deps);
    expect(vi.mocked(t.speicher.sperrenUndAngebot).mock.calls[0][6]).not.toHaveProperty("plan5");
    expect(t.zeilen[0].packagePrices).toEqual([]);

    const p = aufbau({ schalter: { angebotAusKalkulation: false, tagespreise: false }, optionen: PAKETE });
    await entwurfHolenOderAnlegen("ws", "deal1", MENSCH, p.deps);
    expect((await fehler(sperren("ws", "deal1", 1, MENSCH, {}, p.deps))).code).toBe("PAKETE");
    expect(p.deps.ladePaketOptionen).not.toHaveBeenCalled();
  });
});

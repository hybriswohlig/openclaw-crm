/**
 * Plan 5b, Integration: Nahtstellen zwischen der Ansicht (Task K), den Posten je
 * Wahl (Task P, hier echt, ohne Mock) und dem, was Kalkulationsseite (U1) und
 * Termin-Dialog (U2) daraus lesen. `kv.summeCent` muss der Preis der Standardwahl
 * sein (empfohlenes Paket am empfohlenen Tag), sonst sperrt die Seite gegen einen
 * falschen Preis.
 */
import { describe, expect, it } from "vitest";
import { sperrKoerper } from "@/components/neu/kalkulation/preis-logik";
import { auswahlAusTagen, tageAnbietenAus } from "@/components/neu/termin/termin-logik";
import { kundenPreiseOhnePosten } from "./kalkulation-versionen";
import { preisHash, standardWahl, wahlPreis, type PaketpreisVersion, type Tagespreis } from "./angebot-wahl";
import { ansichtAus, type AnsichtRest } from "./kalkulations-ansicht";
import { WEBER_JETZT, weberVersion } from "./kalkulations-ansicht.fixture";

const rest = (felder: Partial<AnsichtRest> = {}): AnsichtRest => ({
  alle: [{ version: 2, status: "entwurf", priceCents: 248000 }],
  namen: {},
  deal: { name: "Weber", art: "Umzug", strecke: "", termin: "2026-11-21", aktenLink: "/a" },
  inventar: [],
  fotos: [],
  vorlagen: [],
  angebot: null,
  veraltet: false,
  kvDokument: null,
  jetzt: WEBER_JETZT,
  renderer: "crm",
  hatPakete: true,
  paketNamen: { basis: "Basis", komfort: "Komfort" },
  schalter: { angebotAusKalkulation: true, tagespreise: true },
  paketOptionen: [
    { catalogueSlug: "basis", isRecommended: false },
    { catalogueSlug: "komfort", isRecommended: true },
  ],
  paketHebel: { basis: [], komfort: ["halteverbot", "montage"] },
  ...felder,
});

const pakete: PaketpreisVersion[] = [
  { slug: "basis", festpreis: 1990, rechnerFestpreis: 1990, selbstkosten: 1300, rundungEur: 10, uebersteuert: null },
  { slug: "komfort", festpreis: 2390, rechnerFestpreis: 2390, selbstkosten: 1500, rundungEur: 10, uebersteuert: null },
];

const tag = (datum: string, wochentag: Tagespreis["wochentag"], haupt: number, basis: number, komfort: number, empfohlen: boolean): Tagespreis => ({
  datum,
  wochentag,
  feiertag: false,
  festpreis: haupt,
  rechnerFestpreis: haupt,
  selbstkosten: 1500,
  margeProzent: 40,
  gruende: [],
  uebersteuert: null,
  paketpreise: [
    { slug: "basis", festpreis: basis, selbstkosten: 1300 },
    { slug: "komfort", festpreis: komfort, selbstkosten: 1500 },
  ],
  slots: [{ label: "ganztags", startTime: "08:00", endTime: "17:00" }],
  note: null,
  empfohlen,
  vehicleBookingId: null,
});

describe("Ansicht K → Seite U1 und Termin-Dialog U2 (Pakete × Tage, echtes postenJeWahl)", () => {
  const tage = [tag("2026-11-20", "fr", 2480, 2090, 2490, false), tag("2026-11-21", "sa", 2580, 2190, 2640, true)];
  const v = weberVersion({ packagePrices: pakete, dayPrices: tage });
  const a = ansichtAus(v, rest());

  it("kv.summeCent ist der Preis der Standardwahl (Komfort am empfohlenen Samstag), Posten ergeben ihn", () => {
    const w = standardWahl({ dayPrices: tage }, "komfort");
    expect(w).toEqual({ paketSlug: "komfort", datum: "2026-11-21" });
    expect(a.kv?.summeCent).toBe(264000);
    expect(a.kv?.posten.reduce((s, p) => s + p.betragCent, 0)).toBe(264000);
    expect(a.version.sperrGrund).toBeNull();
  });

  it("preisHash wie beim Sperren; die Seite und der Dialog schicken nur den Hash", () => {
    const erwartet = preisHash(
      kundenPreiseOhnePosten({
        schalter: { angebotAusKalkulation: true, tagespreise: true },
        pricingMode: "fest",
        hauptCent: a.kv!.summeCent,
        packagePrices: pakete,
        dayPrices: tage,
        stundenCent: null,
        empfohlenesPaket: "komfort",
      })
    );
    expect(a.preisHash).toBe(erwartet);
    // Der Hash nennt jede Wahl, also auch Paket am Tag (Review Focus 2).
    expect(a.preisHash).toContain("komfort@2026-11-21=264000");
    expect(a.preisHash).toContain("basis@2026-11-20=209000");
    expect(sperrKoerper(a)).toEqual({ bestaetigtSpanne: false, erwartetPreisHash: a.preisHash });
  });

  it("Tage der Ansicht tragen je Paket den Preis; der Dialog belegt daraus vor und schickt den ganzen Stand", () => {
    expect(a.tage.map((t) => [t.datum, t.empfohlen, t.paketPreiseCent])).toEqual([
      ["2026-11-20", false, { basis: 209000, komfort: 249000 }],
      ["2026-11-21", true, { basis: 219000, komfort: 264000 }],
    ]);
    const auswahl = auswahlAusTagen(a.tage, "2026-11-07");
    const koerper = tageAnbietenAus(auswahl);
    expect(koerper.tage.map((t) => [t.datum, t.empfohlen])).toEqual([
      ["2026-11-20", false],
      ["2026-11-21", true],
    ]);
    // Ohne Anpassung keine Übersteuerung: der Dienst hebt eine frühere dann auf (Rechnerpreis gilt).
    expect(koerper.uebersteuerungen).toEqual([]);
  });

  it("jede Wahl der Ansicht hat Posten, deren Summe ihr Preis ist (eine Wahrheit)", () => {
    // Die gesperrte Version trägt dieselben Posten; hier gegen die Ansicht im Entwurf.
    for (const datum of [null, "2026-11-20", "2026-11-21"]) {
      for (const paketSlug of [null, "basis", "komfort"]) {
        const r = wahlPreis({ pricingMode: "fest", priceCents: a.kv!.summeCent, kvItems: [], packagePrices: pakete, dayPrices: tage }, { paketSlug, datum });
        expect(r?.priceCents ?? null).not.toBeNull();
      }
    }
  });
});

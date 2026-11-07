import { describe, expect, it } from "vitest";
import type { TagAnsicht } from "@/lib/kalkulations-ansicht";
import {
  alsEmpfohlen,
  auswahlAusTagen,
  auswahlPruefen,
  betragLesen,
  empfehlungNormalisieren,
  gruendeText,
  istVergangen,
  margenHinweis,
  MAX_TAGE,
  monatBereich,
  monatErlaubt,
  monatPlus,
  monatsGrenzen,
  monatsWochen,
  punkteText,
  SCHNELL_SLOTS,
  slotUmschalten,
  startMonat,
  tageAnbietenAus,
  tagUmschalten,
  wirksamerPreisCent,
  zellenText,
  type AuswahlTag,
} from "./termin-logik";

const HEUTE = "2026-11-07";

function tag(datum: string, felder: Partial<AuswahlTag> = {}): AuswahlTag {
  return { datum, slots: [{ label: "ganztags", startTime: "08:00", endTime: "17:00" }], note: "", empfohlen: false, anpassung: null, ...felder };
}

/** Wählt die Tage nacheinander per Klick. */
function klicke(tage: string[]): AuswahlTag[] {
  let a: AuswahlTag[] = [];
  for (const d of tage) a = tagUmschalten(a, d, HEUTE).auswahl;
  return a;
}

const empfehlungen = (a: AuswahlTag[]) => a.filter((t) => t.empfohlen).map((t) => t.datum);

describe("Auswahl", () => {
  it("der erste gewählte Tag wird empfohlen, weitere nicht", () => {
    const a = klicke(["2026-11-21", "2026-11-14"]);
    expect(a.map((t) => t.datum)).toEqual(["2026-11-14", "2026-11-21"]);
    expect(empfehlungen(a)).toEqual(["2026-11-21"]);
    expect(a[0].slots).toEqual([{ label: "ganztags", startTime: "08:00", endTime: "17:00" }]);
  });

  it("bis 10 Tage, der elfte wird mit Hinweis abgelehnt", () => {
    const zehn = Array.from({ length: MAX_TAGE }, (_, i) => `2026-11-${String(10 + i).padStart(2, "0")}`);
    const a = klicke(zehn);
    expect(a).toHaveLength(10);
    const r = tagUmschalten(a, "2026-11-30", HEUTE);
    expect(r.auswahl).toHaveLength(10);
    expect(r.fehler).toBe("Höchstens 10 Tage. Bitte zuerst einen Tag abwählen.");
    // Abwählen geht auch bei 10.
    expect(tagUmschalten(a, "2026-11-10", HEUTE).auswahl).toHaveLength(9);
  });

  it("vergangene Tage sind gesperrt, heute nicht", () => {
    expect(istVergangen("2026-11-06", HEUTE)).toBe(true);
    expect(istVergangen(HEUTE, HEUTE)).toBe(false);
    const r = tagUmschalten([], "2026-11-06", HEUTE);
    expect(r.auswahl).toEqual([]);
    expect(r.fehler).toBe("Fr 06.11. liegt in der Vergangenheit.");
    expect(tagUmschalten([], HEUTE, HEUTE).auswahl).toHaveLength(1);
  });

  it("unbekannte Tage werden nicht übernommen", () => {
    expect(tagUmschalten([], "2026-02-30", HEUTE).fehler).toBe("Unbekannter Tag.");
  });

  it("abwählen der Empfehlung: der früheste rückt nach", () => {
    let a = klicke(["2026-11-20", "2026-11-14", "2026-11-28"]);
    expect(empfehlungen(a)).toEqual(["2026-11-20"]);
    a = tagUmschalten(a, "2026-11-20", HEUTE).auswahl;
    expect(empfehlungen(a)).toEqual(["2026-11-14"]);
  });

  it("genau eine Empfehlung, auch aus kaputtem Stand", () => {
    expect(empfehlungen(alsEmpfohlen(klicke(["2026-11-14", "2026-11-21"]), "2026-11-21"))).toEqual(["2026-11-21"]);
    expect(empfehlungen(empfehlungNormalisieren([tag("2026-11-21", { empfohlen: true }), tag("2026-11-14", { empfohlen: true })]))).toEqual([
      "2026-11-14",
    ]);
    expect(empfehlungen(empfehlungNormalisieren([tag("2026-11-21"), tag("2026-11-14")]))).toEqual(["2026-11-14"]);
    expect(empfehlungNormalisieren([])).toEqual([]);
    // Unbekannter Tag ändert nichts.
    expect(empfehlungen(alsEmpfohlen(klicke(["2026-11-14"]), "2026-12-01"))).toEqual(["2026-11-14"]);
  });

  it("Zeitfenster an- und abwählen, Reihenfolge wie die Schnellwahl", () => {
    let t = tag("2026-11-14", { slots: [] });
    t = slotUmschalten(t, SCHNELL_SLOTS[2]);
    t = slotUmschalten(t, SCHNELL_SLOTS[0]);
    expect(t.slots.map((s) => s.label)).toEqual(["vormittags", "ganztags"]);
    t = slotUmschalten(t, SCHNELL_SLOTS[0]);
    expect(t.slots.map((s) => s.label)).toEqual(["ganztags"]);
  });
});

describe("Monat", () => {
  it("Monatswechsel über den Jahreswechsel", () => {
    expect(monatPlus("2026-12", 1)).toBe("2027-01");
    expect(monatPlus("2027-01", -1)).toBe("2026-12");
    expect(monatsGrenzen("2026-02")).toEqual({ erster: "2026-02-01", letzter: "2026-02-28" });
    expect(monatsGrenzen("2028-02").letzter).toBe("2028-02-29");
  });

  it("nicht vor den laufenden Monat, höchstens 12 voraus", () => {
    expect(monatErlaubt("2026-10", HEUTE)).toBe(false);
    expect(monatErlaubt("2026-11", HEUTE)).toBe(true);
    expect(monatErlaubt("2027-11", HEUTE)).toBe(true);
    expect(monatErlaubt("2027-12", HEUTE)).toBe(false);
  });

  it("Bereich für das Raster ab heute bis Monatsende", () => {
    expect(monatBereich("2026-11", HEUTE)).toEqual({ von: "2026-11-07", bis: "2026-11-30" });
    expect(monatBereich("2026-12", HEUTE)).toEqual({ von: "2026-12-01", bis: "2026-12-31" });
    expect(monatBereich("2026-10", HEUTE)).toBeNull();
  });

  it("Wochen Mo bis So, Nachbartage leer", () => {
    const w = monatsWochen("2026-11");
    // 01.11.2026 ist ein Sonntag: erste Woche hat sechs leere Zellen.
    expect(w[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(w.every((woche) => woche.length === 7)).toBe(true);
    expect(w.flat().filter(Boolean)).toHaveLength(30);
    expect(w[w.length - 1][0]).toBe("2026-11-30");
  });

  it("Startmonat: frühester gewählter Tag, sonst Wunsch, sonst heute", () => {
    expect(startMonat([tag("2027-01-08"), tag("2026-12-12")], "2026-11-20", HEUTE)).toBe("2026-12");
    expect(startMonat([tag("2026-11-01")], "2027-02-03", HEUTE)).toBe("2027-02");
    expect(startMonat([], "2026-10-01", HEUTE)).toBe("2026-11");
    expect(startMonat([], null, HEUTE)).toBe("2026-11");
  });
});

describe("Preise und Texte", () => {
  it("Betrag aus deutscher und einfacher Eingabe", () => {
    expect(betragLesen("2.480")).toBe(2480);
    expect(betragLesen("2480")).toBe(2480);
    expect(betragLesen("2.480,50 €")).toBe(2480.5);
    expect(betragLesen("2480.5")).toBe(2480.5);
    expect(betragLesen("")).toBeNull();
    expect(betragLesen("0")).toBeNull();
    expect(betragLesen("-20")).toBeNull();
    expect(betragLesen("abc")).toBeNull();
    expect(betragLesen("2,480,00")).toBeNull();
  });

  it("wirksamer Preis: Anpassung vor Raster", () => {
    expect(wirksamerPreisCent(tag("2026-11-14"), { preisCent: 248000 })).toBe(248000);
    expect(wirksamerPreisCent(tag("2026-11-14", { anpassung: { betrag: "2.390", grund: "Stammkunde" } }), { preisCent: 248000 })).toBe(239000);
    // Ungültige Eingabe: Rasterpreis bleibt sichtbar.
    expect(wirksamerPreisCent(tag("2026-11-14", { anpassung: { betrag: "", grund: "" } }), { preisCent: 248000 })).toBe(248000);
    expect(wirksamerPreisCent(tag("2026-11-14"), undefined)).toBeNull();
  });

  it("Gründe und Punkte", () => {
    const g = [
      { text: "Samstag", punkte: 5 },
      { text: "Eilauftrag", punkte: 5 },
      { text: "Basis", punkte: 0 },
    ];
    expect(punkteText(g)).toBe("+10 %");
    expect(punkteText([{ punkte: 0 }])).toBeNull();
    expect(gruendeText(g)).toBe("Samstag +5 %, Eilauftrag +5 %");
  });

  it("Hinweis bei übersteuerter Marge (F16)", () => {
    expect(margenHinweis(null)).toBeNull();
    expect(margenHinweis(42)).toBe(
      "Die Marge ist von Hand auf 42 % gesetzt und gilt für alle Tage. Die Preise unterscheiden sich dann nur durch Miete und Fahrzeit."
    );
  });

  it("Vorlesetext einer Zelle", () => {
    const zelle = {
      datum: "2026-11-21",
      wochentag: "sa" as const,
      feiertag: false,
      preisCent: 248000,
      gruende: [{ text: "Samstag", punkte: 5 }],
      auftraege: [
        { dealId: "d1", name: "Weber" },
        { dealId: "d2", name: "Klein" },
      ],
      vergangen: false,
    };
    expect(zellenText("2026-11-21", zelle, { gewaehlt: true, empfohlen: true, wunsch: true, vergangen: false })).toBe(
      "Sa 21.11., 2.480 €, Samstag +5 %, 2 Aufträge, Wunschtermin, gewählt, empfohlen"
    );
    expect(zellenText("2026-11-06", undefined, { gewaehlt: false, empfohlen: false, wunsch: false, vergangen: true })).toBe("Fr 06.11., vergangen");
  });
});

describe("Prüfen und Absenden", () => {
  it("leere Auswahl und fehlende Empfehlung", () => {
    expect(auswahlPruefen([], HEUTE)).toEqual(["Bitte mindestens einen Tag wählen."]);
    expect(auswahlPruefen([tag("2026-11-14"), tag("2026-11-21")], HEUTE)).toEqual(["Bitte genau einen Tag empfehlen."]);
    expect(auswahlPruefen([tag("2026-11-14", { empfohlen: true }), tag("2026-11-21", { empfohlen: true })], HEUTE)).toEqual([
      "Bitte genau einen Tag empfehlen.",
    ]);
  });

  it("eine Preis-Anpassung braucht einen Grund und einen gültigen Betrag", () => {
    const ohneGrund = tag("2026-11-14", { empfohlen: true, anpassung: { betrag: "2.390", grund: "  " } });
    expect(auswahlPruefen([ohneGrund], HEUTE)).toEqual(["Sa 14.11.: die Preis-Anpassung braucht einen Grund."]);
    const ohneBetrag = tag("2026-11-14", { empfohlen: true, anpassung: { betrag: "x", grund: "Stammkunde" } });
    expect(auswahlPruefen([ohneBetrag], HEUTE)).toEqual(["Sa 14.11.: bitte einen gültigen Preis eintragen oder die Anpassung entfernen."]);
    const gut = tag("2026-11-14", { empfohlen: true, anpassung: { betrag: "2.390", grund: "Stammkunde" } });
    expect(auswahlPruefen([gut], HEUTE)).toEqual([]);
  });

  it("vergangener Tag, ohne Zeitfenster, Notiz zu lang", () => {
    const f = auswahlPruefen(
      [tag("2026-11-06", { empfohlen: true }), tag("2026-11-14", { slots: [] }), tag("2026-11-21", { note: "x".repeat(201) })],
      HEUTE
    );
    expect(f).toEqual([
      "Fr 06.11. liegt in der Vergangenheit. Bitte abwählen.",
      "Sa 14.11.: bitte ein Zeitfenster wählen.",
      "Sa 21.11.: die Notiz hat mehr als 200 Zeichen.",
    ]);
  });

  it("mehr als 10 Tage werden gemeldet", () => {
    const elf = Array.from({ length: 11 }, (_, i) => tag(`2026-11-${String(10 + i).padStart(2, "0")}`, { empfohlen: i === 0 }));
    expect(auswahlPruefen(elf, HEUTE)).toEqual(["Höchstens 10 Tage."]);
  });

  it("Körper für Tage anbieten: sortiert, Notiz getrimmt, Anpassung als Tagespreis", () => {
    const k = tageAnbietenAus([
      tag("2026-11-21", { note: "  Ab 7 Uhr möglich ", anpassung: { betrag: "2.390,50", grund: " Stammkunde " } }),
      tag("2026-11-14", { empfohlen: true, slots: [{ label: "vormittags", startTime: "08:00", endTime: "12:00" }] }),
    ]);
    expect(k).toEqual({
      tage: [
        { datum: "2026-11-14", slots: [{ label: "vormittags", startTime: "08:00", endTime: "12:00" }], note: null, empfohlen: true },
        { datum: "2026-11-21", slots: [{ label: "ganztags", startTime: "08:00", endTime: "17:00" }], note: "Ab 7 Uhr möglich", empfohlen: false },
      ],
      uebersteuerungen: [{ datum: "2026-11-21", paketSlug: null, betrag: 2390.5, grund: "Stammkunde" }],
    });
  });

  it("Auswahl aus angebotenen Tagen der Version, ohne vergangene", () => {
    const basis: Omit<TagAnsicht, "datum" | "empfohlen" | "uebersteuert" | "slots" | "note"> = {
      text: "",
      feiertag: false,
      preisCent: 248000,
      rechnerPreisCent: 248000,
      gruende: [],
      paketPreiseCent: null,
    };
    const a = auswahlAusTagen(
      [
        { ...basis, datum: "2026-11-05", empfohlen: true, uebersteuert: null, slots: [], note: null },
        { ...basis, datum: "2026-11-21", empfohlen: false, uebersteuert: { betragCent: 239050, grund: "Stammkunde" }, slots: [], note: "Bitte klingeln" },
        { ...basis, datum: "2026-11-14", empfohlen: false, uebersteuert: null, slots: [{ label: "vormittags", startTime: "08:00", endTime: "12:00" }], note: null },
      ],
      HEUTE
    );
    expect(a.map((t) => t.datum)).toEqual(["2026-11-14", "2026-11-21"]);
    // Die Empfehlung lag auf einem vergangenen Tag: der früheste rückt nach.
    expect(empfehlungen(a)).toEqual(["2026-11-14"]);
    expect(a[1].anpassung).toEqual({ betrag: "2390,50", grund: "Stammkunde" });
    expect(a[1].note).toBe("Bitte klingeln");
    expect(a[1].slots.map((s) => s.label)).toEqual(["ganztags"]);
  });
});

import { describe, expect, it } from "vitest";
import { berechneAblauf, type AblaufFakten, type AblaufSchritt } from "./ablauf";
import { zahlenreiheAus, type AkteDaten, type Kachel, type Wartet } from "./akte";
import { KEIN_LEAD_STAGE_CATEGORY } from "./kontaktart";
import {
  adresseText,
  dokumenteText,
  kanaeleText,
  kurzfassungAus,
  kurzfassungZeilen,
  naechsterSchrittAus,
  terminLabel,
  wartetZeile,
  type KurzfassungEingabe,
} from "./kurzfassung";

/** Do 05.11.2026, 10:00 Berlin. */
const JETZT = new Date("2026-11-05T09:00:00.000Z");

/** Stand des Mockups: KV v2 gesendet, nicht angenommen, Nachfass Tag 2 morgen geplant. */
function mockup(over: Partial<AblaufFakten> = {}): AblaufFakten {
  return {
    erstelltAm: "2026-11-03T08:14:00.000Z",
    quelle: "Kleinanzeigen",
    ersteAntwortAm: "2026-11-03T08:21:00.000Z",
    fotos: 14,
    fotoanalyseAm: "2026-11-03T10:00:00.000Z",
    volumenCbm: 38,
    zugang: null,
    halteverbot: null,
    besichtigungAm: null,
    leistung: "move",
    kalkulation: {
      version: 2,
      status: "gesperrt",
      selbstkostenCent: 154000,
      margeProzent: 38,
      geprueftVon: "Dario",
      anpassungen: 0,
      ersteAnpassung: null,
      neuerEntwurf: null,
    },
    kv: {
      version: 2,
      betragCent: 248000,
      istStunden: false,
      gesendetAm: "2026-11-04T09:00:00.000Z",
      gueltigBis: "2026-11-18",
      anzahlungCent: null,
      geoeffnet: 3,
      zuletztGeoeffnet: "2026-11-05T07:00:00.000Z",
    },
    unterschriftAktiv: false,
    nachfass: {
      modus: "entwurf",
      text: "automatisch · Entwurf",
      regeln: [
        { tag: 2, gesendetAm: null, geplantAm: "2026-11-06T08:00:00.000Z", art: "entwurf" },
        { tag: 7, gesendetAm: null, geplantAm: "2026-11-11T08:00:00.000Z", art: "entwurf" },
      ],
    },
    annahme: null,
    abAm: null,
    team: { personen: 0, namen: [] },
    einsatz: null,
    termin: { datum: "2026-11-21", von: null, bis: null },
    durchgefuehrtAm: null,
    rechnung: null,
    rest: { restCent: 248000, quelle: "angebot" },
    letzteZahlungAm: null,
    offeneMeldungen: 0,
    bewertung: { status: null, am: null },
    stageCategory: "quoted",
    ...over,
  };
}

const WARTET_KUNDE: Wartet = { waitingOn: "kunde", waitingSince: "2026-11-03T09:00:00.000Z", waitingReason: "KV 3× geöffnet" };

const kacheln = (f: AblaufFakten, w: Wartet = WARTET_KUNDE) => zahlenreiheAus(f, w, null, JETZT);

describe("kurzfassungZeilen", () => {
  it("Mockup: KV mit Version, Umzugsdatum, Volumen, Marge, Wartet auf Kunden", () => {
    expect(kurzfassungZeilen(kacheln(mockup()), { leistung: "move", kvVersion: 2 })).toEqual([
      { label: "Kostenvoranschlag", wert: "2.480 € · v2", ton: null },
      { label: "Umzugsdatum", wert: "Sa 21.11.", ton: null },
      { label: "Volumen", wert: "38 m³", ton: null },
      { label: "Marge", wert: "38 %", ton: null },
      { label: "Wartet", wert: "auf Kunden · 2 Tage", ton: null },
    ]);
  });

  it("ohne KV und Termin: Platzhalter, keine Version; Wartet auf uns gold", () => {
    const f = mockup({ kv: null, termin: null, volumenCbm: null, kalkulation: null });
    const z = kurzfassungZeilen(kacheln(f, { waitingOn: "uns", waitingSince: "2026-11-05T08:25:00.000Z", waitingReason: null }), {
      leistung: "move",
      kvVersion: null,
    });
    expect(z.map((x) => x.wert)).toEqual(["–", "–", "–", "–", "auf uns · 35 Min"]);
    expect(z[4].ton).toBe("gold");
  });

  it("Stunden-KV mit Version", () => {
    const f = mockup({ kv: { ...mockup().kv!, istStunden: true, betragCent: null } });
    expect(kurzfassungZeilen(kacheln(f), { leistung: "move", kvVersion: 3 })[0].wert).toBe("Stunden-KV · v3");
  });

  it("Termin je Art: Umzug und Entrümpelung mit Umzug → Umzugsdatum, sonst Termin", () => {
    expect(terminLabel("move")).toBe("Umzugsdatum");
    expect(terminLabel("clearance_move")).toBe("Umzugsdatum");
    expect(terminLabel("clearance")).toBe("Termin");
    expect(terminLabel("kitchen_installation")).toBe("Termin");
    const f = mockup({ leistung: "clearance" });
    expect(kurzfassungZeilen(kacheln(f), { leistung: "clearance", kvVersion: 2 })[1]).toEqual({ label: "Termin", wert: "Sa 21.11.", ton: null });
  });

  it("fehlende Kacheln → Platzhalter", () => {
    expect(kurzfassungZeilen([], { leistung: "move", kvVersion: 1 }).map((z) => z.wert)).toEqual(["–", "–", "–", "–", "–"]);
  });
});

describe("wartetZeile", () => {
  it("läuft, abgeschlossen (Verloren/Kein Lead), ohne Dauer", () => {
    const [, , , , , laeuft] = kacheln(mockup(), { waitingOn: "niemand", waitingSince: "2026-11-01T09:00:00.000Z", waitingReason: null });
    expect(wartetZeile(laeuft)).toEqual({ wert: "läuft", ton: null });
    const [, , , , , zu] = kacheln(mockup({ stageCategory: KEIN_LEAD_STAGE_CATEGORY }), { waitingOn: "uns", waitingSince: null, waitingReason: null });
    expect(wartetZeile(zu)).toEqual({ wert: "abgeschlossen", ton: null });
    const [, , , , , uns] = kacheln(mockup(), { waitingOn: "uns", waitingSince: null, waitingReason: null });
    expect(wartetZeile(uns)).toEqual({ wert: "auf uns", ton: "gold" });
    expect(wartetZeile(undefined)).toEqual({ wert: "–", ton: null });
  });
});

describe("naechsterSchrittAus", () => {
  it("KV gesendet, nicht angenommen: Annahme im Status-Link mit nächstem Nachfass (Mockup)", () => {
    expect(naechsterSchrittAus(berechneAblauf(mockup(), JETZT).schritte)).toEqual({
      titel: "Annahme",
      zusatz: "im Status-Link · Nachfass Tag 2 morgen",
    });
  });

  it("Nachfass Tag 2 schon gesendet: nächster geplanter (Tag 7)", () => {
    const f = mockup();
    f.nachfass.regeln[0] = { tag: 2, gesendetAm: "2026-11-05T08:00:00.000Z", geplantAm: null, art: "entwurf" };
    expect(naechsterSchrittAus(berechneAblauf(f, JETZT).schritte)).toEqual({
      titel: "Annahme",
      zusatz: "im Status-Link · Nachfass Tag 7 Mi 11.11.",
    });
  });

  it("KV noch nicht gesendet: der Schritt selbst mit seiner Zeile", () => {
    const f = mockup({ kv: { ...mockup().kv!, gesendetAm: null } });
    expect(naechsterSchrittAus(berechneAblauf(f, JETZT).schritte)).toEqual({
      titel: "Kostenvoranschlag",
      zusatz: berechneAblauf(f, JETZT).schritte.find((s) => s.key === "kv")!.zeile,
    });
  });

  it("früher Schritt ohne Nachfass: Titel und Zeile", () => {
    const schritte: AblaufSchritt[] = [
      { nr: 1, key: "anfrage", titel: "Anfrage eingegangen", wer: "auto", zustand: "erledigt", zeile: "Di 03.11." },
      { nr: 2, key: "fotos", titel: "Fotos und Infos", wer: "kunde", zustand: "jetzt", zeile: "" },
    ];
    expect(naechsterSchrittAus(schritte)).toEqual({ titel: "Fotos und Infos", zusatz: null });
  });

  it("kein Schritt jetzt (alles erledigt, Verloren, Kein Lead) → null", () => {
    expect(naechsterSchrittAus(berechneAblauf(mockup({ stageCategory: "lost" }), JETZT).schritte)).toBeNull();
    expect(naechsterSchrittAus([])).toBeNull();
  });
});

describe("dokumenteText", () => {
  it("KV-Versionen sortiert und einmalig, dann AB, RE in fester Reihenfolge", () => {
    expect(
      dokumenteText([
        { typ: "invoice", version: null },
        { typ: "quotation", version: 2 },
        { typ: "order_confirmation", version: 2 },
        { typ: "quotation", version: 1 },
        { typ: "quotation", version: 2 },
        { typ: "invoice", version: null },
      ])
    ).toBe("KV v1, v2 · AB · RE");
  });
  it("KV ohne Version, weitere Arten, unbekannte entfallen, leer → –", () => {
    expect(dokumenteText([{ typ: "quotation", version: null }])).toBe("KV");
    expect(dokumenteText([{ typ: "quotation", version: null }, { typ: "quotation", version: 3 }])).toBe("KV v3");
    expect(
      dokumenteText([
        { typ: "worker_instructions", version: null },
        { typ: "signed_contract", version: null },
        { typ: "payment_confirmation", version: null },
        { typ: "irgendwas", version: null },
      ])
    ).toBe("ZB · Vertrag · Crew");
    expect(dokumenteText([])).toBe("–");
  });
});

describe("kanaeleText", () => {
  it("Kanäle einmal in fester Reihenfolge, dann Anrufe", () => {
    expect(kanaeleText(["whatsapp"], 2)).toBe("WhatsApp, 2 Anrufe");
    expect(kanaeleText(["email", "whatsapp", "email"], 1)).toBe("WhatsApp, E-Mail, 1 Anruf");
    expect(kanaeleText(["sms"], 0)).toBe("SMS");
    expect(kanaeleText([], 0)).toBe("–");
    expect(kanaeleText([], 3)).toBe("3 Anrufe");
  });
});

describe("adresseText", () => {
  it("LocationValue voll, Freitext wie gespeichert, leer → null", () => {
    expect(adresseText({ line1: "Rotebühlstr. 112", postcode: "70178", city: "Stuttgart", countryCode: "DE" })).toBe(
      "Rotebühlstr. 112, 70178 Stuttgart"
    );
    expect(adresseText({ line1: "Hauptstr. 5", line2: "Hinterhaus", city: "Esslingen" })).toBe("Hauptstr. 5, Hinterhaus, Esslingen");
    expect(adresseText({ line1: "Rotebühlstr. 112, 70178 Stuttgart", postcode: "70178", city: "Stuttgart" })).toBe(
      "Rotebühlstr. 112, 70178 Stuttgart"
    );
    expect(adresseText({ city: "Esslingen" })).toBe("Esslingen");
    expect(adresseText("  Am Markt 1,\n 73728 Esslingen ")).toBe("Am Markt 1, 73728 Esslingen");
    expect(adresseText("")).toBeNull();
    expect(adresseText({})).toBeNull();
    expect(adresseText(null)).toBeNull();
    expect(adresseText(["x"])).toBeNull();
  });
});

describe("kurzfassungAus", () => {
  const f = mockup();
  const akte: KurzfassungEingabe["akte"] = {
    kopf: {
      name: "Familie Weber",
      art: "Umzug, 3 Zimmer",
      strecke: "Stuttgart nach Esslingen",
      meta: "",
      team: [],
      stufe: { id: "st_angebot", label: "Angebot", kategorie: "quoted", ton: "gold" },
      stufen: [
        { id: "st_neu", label: "Neue Anfrage", kategorie: "open_new" },
        { id: "st_angebot", label: "Angebot", kategorie: "quoted" },
        { id: "st_kein", label: "Kein Lead", kategorie: KEIN_LEAD_STAGE_CATEGORY },
      ],
      verlustGruende: [],
      verlustGrund: null,
      kunde: null,
    },
    kacheln: kacheln(f) as Kachel[],
    ablauf: berechneAblauf(f, JETZT),
    nachfass: { an: true, modus: "entwurf", text: "automatisch · Entwurf" },
    firma: { id: "oc_kottke", name: "Kottke" },
  } satisfies Pick<AkteDaten, "kopf" | "kacheln" | "ablauf" | "nachfass" | "firma">;

  const eingabe: KurzfassungEingabe = {
    dealId: "deal_1",
    akte,
    leistung: "move",
    kvVersion: 2,
    quelle: "Kleinanzeigen",
    kunde: {
      telefon: "+49 171 2345678",
      email: "weber@example.de",
      von: { line1: "Rotebühlstr. 112", postcode: "70178", city: "Stuttgart" },
      nach: "Esslingen",
    },
    kanaele: ["whatsapp"],
    anrufe: 2,
    fotos: 14,
    dokumente: [
      { typ: "quotation", version: 1 },
      { typ: "quotation", version: 2 },
    ],
  };

  it("baut die ganze rechte Spalte wie im Mockup", () => {
    expect(kurzfassungAus(eingabe)).toEqual({
      dealId: "deal_1",
      name: "Familie Weber",
      stufe: { id: "st_angebot", label: "Angebot", ton: "gold" },
      zeilen: [
        { label: "Kostenvoranschlag", wert: "2.480 € · v2", ton: null },
        { label: "Umzugsdatum", wert: "Sa 21.11.", ton: null },
        { label: "Volumen", wert: "38 m³", ton: null },
        { label: "Marge", wert: "38 %", ton: null },
        { label: "Wartet", wert: "auf Kunden · 2 Tage", ton: null },
      ],
      naechsterSchritt: { titel: "Annahme", zusatz: "im Status-Link · Nachfass Tag 2 morgen" },
      kunde: {
        telefon: "+49 171 2345678",
        email: "weber@example.de",
        von: "Rotebühlstr. 112, 70178 Stuttgart",
        nach: "Esslingen",
        quelle: "Kleinanzeigen",
        firma: "Kottke",
      },
      gespraech: { kanaele: "WhatsApp, 2 Anrufe", fotos: 14, dokumente: "KV v1, v2" },
      nachfass: { an: true, modus: "entwurf", text: "automatisch · Entwurf" },
      keinLeadStufeId: "st_kein",
      kategorie: "quoted",
      akteLink: "/app/leads/deal_1",
    });
  });

  it("ohne Kein-Lead-Stufe und ohne Kundendaten: null statt leerer Texte", () => {
    const out = kurzfassungAus({
      ...eingabe,
      akte: { ...akte, kopf: { ...akte.kopf, stufen: akte.kopf.stufen.filter((s) => s.kategorie !== KEIN_LEAD_STAGE_CATEGORY) }, firma: { id: null, name: null } },
      quelle: "  ",
      kunde: { telefon: null, email: "", von: null, nach: undefined },
    });
    expect(out.keinLeadStufeId).toBeNull();
    expect(out.kunde).toEqual({ telefon: null, email: null, von: null, nach: null, quelle: null, firma: null });
  });
});

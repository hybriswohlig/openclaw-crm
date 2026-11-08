import { describe, expect, it } from "vitest";
import {
  LEERER_FILTER,
  LISTEN_SPALTEN,
  OHNE_STUFE,
  STANDARD_ANSICHT,
  ablageText,
  betragAnzeige,
  chipText,
  filterAusParams,
  filterZuParams,
  firmenPunktFarbe,
  kategorieRang,
  leadsAnsichtAus,
  leadsAnsichtPruefen,
  monatsOptionen,
  sortierungAusParams,
  summeAnzeige,
  vorText,
  wartetPille,
  wasZeile,
  wocheGrenzen,
  zugAktion,
  zugDialogText,
  type LeadKategorie,
  type LeadsChipKey,
  type LeadsFilter,
  type ListenSortierung,
  type RueckfrageGrund,
  type ZugAktion,
  type ZugFakten,
  type ZugZiel,
} from "./leads-board";

/** Freitag, 06.11.2026, 12:00 in Berlin (UTC+1). */
const JETZT = new Date("2026-11-06T11:00:00.000Z");
const vor = (minuten: number) => new Date(JETZT.getTime() - minuten * 60_000).toISOString();
const TAG = 24 * 60;

const LEER: ZugFakten = { annahmeAm: null, kvVorhanden: false, verlustGrund: null };
const fakt = (teil: Partial<ZugFakten>): ZugFakten => ({ ...LEER, ...teil });
const ziel = (stufeId: string, kategorie: LeadKategorie | null): ZugZiel => ({ stufeId, kategorie });

const NEU = ziel("st-neu", "open_new");
const NEU_B = ziel("st-neu-b", "open_new");
const KONTAKT = ziel("st-kontakt", "open_engaged");
const ANGEBOT = ziel("st-angebot", "quoted");
const ANGEBOT_B = ziel("st-angebot-b", "quoted");
const GEPLANT = ziel("st-geplant", "booked");
const DURCH = ziel("st-durch", "done_unpaid");
const BEZAHLT = ziel("st-bezahlt", "paid");
const VERLOREN = ziel("st-verloren", "lost");
const KEIN = ziel("st-kein", "kein_lead");
const OHNE = ziel(OHNE_STUFE, null);

describe("zugAktion", () => {
  it.each<{ name: string; von: ZugZiel; nach: ZugZiel; fakten: ZugFakten; erwartet: ZugAktion }>([
    { name: "gleiche Stufe", von: NEU, nach: NEU, fakten: LEER, erwartet: { art: "keine" } },
    {
      name: "gleiche Stufen-ID trotz anderer Kategorie",
      von: NEU,
      nach: { stufeId: NEU.stufeId, kategorie: "quoted" },
      fakten: LEER,
      erwartet: { art: "keine" },
    },
    { name: "Ziel Ohne Stufe", von: KONTAKT, nach: OHNE, fakten: LEER, erwartet: { art: "keine" } },
    {
      name: "Ziel Ohne Stufe auch mit Kategorie",
      von: KONTAKT,
      nach: { stufeId: OHNE_STUFE, kategorie: "lost" },
      fakten: LEER,
      erwartet: { art: "keine" },
    },
    {
      name: "Ziel ohne Kategorie",
      von: NEU,
      nach: { stufeId: "st-fremd", kategorie: null },
      fakten: LEER,
      erwartet: { art: "keine" },
    },
    {
      name: "Verloren ohne Grund",
      von: ANGEBOT,
      nach: VERLOREN,
      fakten: LEER,
      erwartet: { art: "verlustgrund" },
    },
    {
      name: "Verloren mit gespeichertem Grund",
      von: ANGEBOT,
      nach: VERLOREN,
      fakten: fakt({ verlustGrund: "grund-preis" }),
      erwartet: { art: "rueckfrage", grund: "verloren" },
    },
    {
      name: "Verloren aus Bezahlt bleibt Verlust, nicht rückwärts",
      von: BEZAHLT,
      nach: VERLOREN,
      fakten: LEER,
      erwartet: { art: "verlustgrund" },
    },
    {
      name: "Kein Lead",
      von: ANGEBOT,
      nach: KEIN,
      fakten: fakt({ verlustGrund: "grund-preis" }),
      erwartet: { art: "rueckfrage", grund: "kein_lead" },
    },
    {
      name: "aus Verloren heraus",
      von: VERLOREN,
      nach: NEU,
      fakten: fakt({ verlustGrund: "grund-preis" }),
      erwartet: { art: "rueckfrage", grund: "wieder_offen" },
    },
    {
      name: "aus Kein Lead heraus, nur die Wieder-offen-Frage",
      von: KEIN,
      nach: BEZAHLT,
      fakten: fakt({ kvVorhanden: true, annahmeAm: "2026-11-01" }),
      erwartet: { art: "rueckfrage", grund: "wieder_offen" },
    },
    {
      name: "aus Verloren nach Ohne Stufe bleibt ohne Aktion",
      von: VERLOREN,
      nach: OHNE,
      fakten: LEER,
      erwartet: { art: "keine" },
    },
    {
      name: "von Verloren nach Verloren fragt den Grund, nicht wieder offen",
      von: VERLOREN,
      nach: ziel("st-verloren-b", "lost"),
      fakten: LEER,
      erwartet: { art: "verlustgrund" },
    },
    {
      name: "rückwärts",
      von: GEPLANT,
      nach: ANGEBOT,
      fakten: fakt({ kvVorhanden: true }),
      erwartet: { art: "rueckfrage", grund: "rueckwaerts" },
    },
    {
      name: "rückwärts über mehrere Stufen",
      von: DURCH,
      nach: NEU,
      fakten: LEER,
      erwartet: { art: "rueckfrage", grund: "rueckwaerts" },
    },
    {
      name: "rückwärts aus Bezahlt, nicht wieder offen",
      von: BEZAHLT,
      nach: DURCH,
      fakten: LEER,
      erwartet: { art: "rueckfrage", grund: "rueckwaerts" },
    },
    { name: "seitwärts in derselben Kategorie", von: NEU, nach: NEU_B, fakten: LEER, erwartet: { art: "setzen" } },
    {
      name: "seitwärts im Angebot setzt nur die Stufe",
      von: ANGEBOT,
      nach: ANGEBOT_B,
      fakten: LEER,
      erwartet: { art: "setzen" },
    },
    {
      name: "vorwärts nach Neue Anfrage aus Ohne Stufe",
      von: OHNE,
      nach: NEU,
      fakten: LEER,
      erwartet: { art: "setzen" },
    },
    { name: "vorwärts nach In Kontakt", von: NEU, nach: KONTAKT, fakten: LEER, erwartet: { art: "setzen" } },
    {
      name: "Angebot ohne KV",
      von: KONTAKT,
      nach: ANGEBOT,
      fakten: LEER,
      erwartet: { art: "kv" },
    },
    {
      name: "Angebot mit KV",
      von: KONTAKT,
      nach: ANGEBOT,
      fakten: fakt({ kvVorhanden: true }),
      erwartet: { art: "rueckfrage", grund: "kv_vorhanden" },
    },
    {
      name: "Geplant ohne Annahme",
      von: ANGEBOT,
      nach: GEPLANT,
      fakten: fakt({ kvVorhanden: true }),
      erwartet: { art: "beauftragung" },
    },
    {
      name: "Geplant mit Annahme",
      von: ANGEBOT,
      nach: GEPLANT,
      fakten: fakt({ annahmeAm: "2026-11-07", kvVorhanden: true }),
      erwartet: { art: "rueckfrage", grund: "angenommen" },
    },
    {
      name: "Durchgeführt",
      von: GEPLANT,
      nach: DURCH,
      fakten: fakt({ annahmeAm: "2026-11-07" }),
      erwartet: { art: "rueckfrage", grund: "durchgefuehrt" },
    },
    {
      name: "Bezahlt",
      von: DURCH,
      nach: BEZAHLT,
      fakten: LEER,
      erwartet: { art: "zahlung" },
    },
    {
      name: "Sprung nach Bezahlt löst nur die Zahlung aus",
      von: NEU,
      nach: BEZAHLT,
      fakten: fakt({ kvVorhanden: true, annahmeAm: "2026-11-07" }),
      erwartet: { art: "zahlung" },
    },
    {
      name: "Sprung nach Durchgeführt löst nur diese Rückfrage aus",
      von: NEU,
      nach: DURCH,
      fakten: LEER,
      erwartet: { art: "rueckfrage", grund: "durchgefuehrt" },
    },
  ])("$name", ({ von, nach, fakten, erwartet }) => {
    expect(zugAktion(von, nach, fakten)).toEqual(erwartet);
  });
});

describe("ablageText", () => {
  const rueckfrage = (grund: RueckfrageGrund): ZugAktion => ({ art: "rueckfrage", grund });

  it.each<{ name: string; aktion: ZugAktion; text: string | null }>([
    { name: "keine", aktion: { art: "keine" }, text: null },
    { name: "setzen", aktion: { art: "setzen" }, text: "Hierher ziehen = Stufe setzen" },
    { name: "rückwärts", aktion: rueckfrage("rueckwaerts"), text: "Hierher ziehen = zurücksetzen" },
    { name: "wieder offen", aktion: rueckfrage("wieder_offen"), text: "Hierher ziehen = wieder öffnen" },
    { name: "KV vorhanden", aktion: rueckfrage("kv_vorhanden"), text: "Hierher ziehen = Stufe setzen" },
    { name: "angenommen", aktion: rueckfrage("angenommen"), text: "Hierher ziehen = Auftrag bestätigen" },
    {
      name: "durchgeführt",
      aktion: rueckfrage("durchgefuehrt"),
      text: "Hierher ziehen = Als durchgeführt markieren",
    },
    { name: "verloren", aktion: rueckfrage("verloren"), text: "Hierher ziehen = Als verloren markieren" },
    { name: "kein Lead", aktion: rueckfrage("kein_lead"), text: "Hierher ziehen = Als Kein Lead markieren" },
    { name: "Verlustgrund", aktion: { art: "verlustgrund" }, text: "Hierher ziehen = Als verloren markieren" },
    { name: "KV", aktion: { art: "kv" }, text: "Hierher ziehen = KV erstellen" },
    { name: "Beauftragung", aktion: { art: "beauftragung" }, text: "Hierher ziehen = Auftrag bestätigen" },
    { name: "Zahlung", aktion: { art: "zahlung" }, text: "Hierher ziehen = Zahlung erfassen" },
  ])("$name", ({ aktion, text }) => {
    expect(ablageText(aktion)).toBe(text);
  });
});

describe("zugDialogText", () => {
  const von = "Angebot";
  const nach = "Geplant";

  it("KV, Beauftragung und jede Rückfrage", () => {
    expect(zugDialogText({ art: "kv" }, von, "Angebot", LEER)).toEqual({
      titel: "KV erstellen",
      text: "Die Kalkulation öffnet sich. Dort prüfst du die Zahlen, sperrst die Version und erstellst den KV. Die Stufe springt danach von selbst auf „Angebot“. Verschickt wird erst, wenn du es dort auslöst.",
      knopf: "Zur Kalkulation",
      haken: null,
    });

    expect(zugDialogText({ art: "beauftragung" }, von, nach, LEER)).toEqual({
      titel: "Ohne Annahme auf „Geplant“?",
      text: "Der Kunde hat den KV nicht im Portal angenommen. Bestätige nur, wenn er anders beauftragt hat, etwa am Telefon oder per Nachricht.",
      knopf: "Beauftragung bestätigen",
      haken: "Der Kunde hat den Auftrag erteilt.",
    });

    expect(zugDialogText({ art: "rueckfrage", grund: "rueckwaerts" }, "Angebot", "Neue Anfrage", LEER)).toEqual({
      titel: "Zurück auf „Neue Anfrage“?",
      text: "Der Deal geht von „Angebot“ zurück auf „Neue Anfrage“. Dokumente und Zahlungen bleiben, wie sie sind.",
      knopf: "Auf „Neue Anfrage“ setzen",
      haken: null,
    });

    expect(zugDialogText({ art: "rueckfrage", grund: "wieder_offen" }, "Verloren", "In Kontakt", LEER)).toEqual({
      titel: "Wieder auf „In Kontakt“?",
      text: "Der Deal ist danach wieder offen. Ein gespeicherter Verlustgrund bleibt stehen.",
      knopf: "Auf „In Kontakt“ setzen",
      haken: null,
    });

    expect(zugDialogText({ art: "rueckfrage", grund: "kv_vorhanden" }, von, "Angebot", fakt({ kvVorhanden: true }))).toEqual({
      titel: "Auf „Angebot“ setzen?",
      text: "Für diesen Deal gibt es schon einen KV. Nur die Stufe wechselt, verschickt wird nichts.",
      knopf: "Auf „Angebot“ setzen",
      haken: null,
    });

    expect(
      zugDialogText({ art: "rueckfrage", grund: "angenommen" }, von, nach, fakt({ annahmeAm: "2026-11-07" })),
    ).toEqual({
      titel: "Auftrag bestätigen?",
      text: "Der Kunde hat am 07.11. angenommen. Der Deal wechselt auf „Geplant“.",
      knopf: "Auf „Geplant“ setzen",
      haken: null,
    });

    expect(zugDialogText({ art: "rueckfrage", grund: "angenommen" }, von, nach, LEER)).toEqual({
      titel: "Auftrag bestätigen?",
      text: "Der Deal wechselt auf „Geplant“.",
      knopf: "Auf „Geplant“ setzen",
      haken: null,
    });

    expect(zugDialogText({ art: "rueckfrage", grund: "durchgefuehrt" }, nach, "Durchgeführt", LEER)).toEqual({
      titel: "Als durchgeführt markieren?",
      text: "Das CRM vermerkt heute als Durchführungstag. Danach geht es um Rechnung und Zahlung.",
      knopf: "Als durchgeführt markieren",
      haken: null,
    });

    expect(zugDialogText({ art: "rueckfrage", grund: "verloren" }, von, "Verloren", fakt({ verlustGrund: "g" }))).toEqual({
      titel: "Als verloren markieren?",
      text: "Der gespeicherte Verlustgrund bleibt.",
      knopf: "Als verloren markieren",
      haken: null,
    });

    expect(zugDialogText({ art: "rueckfrage", grund: "kein_lead" }, von, "Kein Lead", LEER)).toEqual({
      titel: "Als Kein Lead markieren?",
      text: "Der Deal wandert in die eingeklappte Gruppe „Kein Lead“ und wird nicht mehr nachgefasst.",
      knopf: "Als Kein Lead markieren",
      haken: null,
    });
  });

  it("setzen, keine, Verlustgrund und Zahlung haben keinen eigenen Dialog", () => {
    expect(zugDialogText({ art: "setzen" }, von, nach, LEER)).toBeNull();
    expect(zugDialogText({ art: "keine" }, von, nach, LEER)).toBeNull();
    expect(zugDialogText({ art: "verlustgrund" }, von, "Verloren", LEER)).toBeNull();
    expect(zugDialogText({ art: "zahlung" }, von, "Bezahlt", LEER)).toBeNull();
  });
});

describe("wartetPille", () => {
  it("Endstufen ohne Pille", () => {
    const zeile = { auf: "uns" as const, seit: vor(35), grund: "ungesehen" };
    for (const kategorie of ["paid", "lost", "kein_lead"] as const) {
      expect(wartetPille(zeile, kategorie, JETZT, "Termin Fr 14.11.")).toEqual({
        auf: "niemand",
        seit: null,
        text: null,
        ton: null,
      });
    }
  });

  it("keine Zeile läuft, niemand mit Grund hängt den Grund an", () => {
    expect(wartetPille(null, "booked", JETZT)).toEqual({
      auf: "niemand",
      seit: null,
      text: "läuft",
      ton: "jade",
    });
    expect(wartetPille({ auf: "niemand", seit: vor(10), grund: "Team fehlt" }, "booked", JETZT)).toEqual({
      auf: "niemand",
      seit: null,
      text: "läuft",
      ton: "jade",
    });
    expect(wartetPille({ auf: "niemand", seit: null, grund: null }, "booked", JETZT, "Termin Fr 14.11.")).toEqual({
      auf: "niemand",
      seit: null,
      text: "läuft · Termin Fr 14.11.",
      ton: "jade",
    });
    expect(wartetPille(null, null, JETZT, "Besichtigung Do 07.11. 16:00")).toEqual({
      auf: "niemand",
      seit: null,
      text: "läuft · Besichtigung Do 07.11. 16:00",
      ton: "jade",
    });
  });

  it("uns gold, kunde grau, ungesehen in der Farbe von auf, ohne seit nur der Kopf", () => {
    expect(wartetPille({ auf: "uns", seit: vor(35), grund: null }, "open_new", JETZT)).toEqual({
      auf: "uns",
      seit: vor(35),
      text: "Wartet auf uns · 35 Min",
      ton: "gold",
    });
    expect(wartetPille({ auf: "kunde", seit: vor(2 * TAG), grund: null }, "quoted", JETZT)).toEqual({
      auf: "kunde",
      seit: vor(2 * TAG),
      text: "Wartet auf Kunden · 2 Tage",
      ton: "grau",
    });
    expect(wartetPille({ auf: "uns", seit: vor(4 * TAG), grund: "KV Ungesehen" }, "quoted", JETZT)).toEqual({
      auf: "uns",
      seit: vor(4 * TAG),
      text: "KV ungesehen · 4 Tage",
      ton: "gold",
    });
    expect(wartetPille({ auf: "kunde", seit: vor(4 * TAG), grund: "ungesehen" }, "quoted", JETZT)).toEqual({
      auf: "kunde",
      seit: vor(4 * TAG),
      text: "KV ungesehen · 4 Tage",
      ton: "grau",
    });
    expect(wartetPille({ auf: "uns", seit: null, grund: null }, "open_engaged", JETZT)).toEqual({
      auf: "uns",
      seit: null,
      text: "Wartet auf uns",
      ton: "gold",
    });
    expect(wartetPille({ auf: "kunde", seit: null, grund: "ungesehen" }, "quoted", JETZT)).toEqual({
      auf: "kunde",
      seit: null,
      text: "KV ungesehen",
      ton: "grau",
    });
  });
});

describe("betragAnzeige und summeAnzeige", () => {
  it("fest, geschätzt, ohne Preis, Summe mit Tilde oder leer", () => {
    expect(betragAnzeige(null)).toBe("ohne Preis");
    expect(betragAnzeige({ cent: 248_000, art: "fest" })).toBe("2.480 €");
    expect(betragAnzeige({ cent: 190_000, art: "geschaetzt" })).toBe("~1.900 €");
    expect(summeAnzeige(null, false)).toBe("");
    expect(summeAnzeige(null, true)).toBe("");
    expect(summeAnzeige(823_000, false)).toBe("8.230 €");
    expect(summeAnzeige(490_000, true)).toBe("~4.900 €");
  });
});

describe("wasZeile", () => {
  it("Geplant mit Wochentag, ein Ort, gleiche Orte, ohne Datum", () => {
    expect(
      wasZeile({
        art: "Umzug",
        von: "Stuttgart-Ost",
        nach: "Fellbach",
        termin: "2026-11-13",
        kategorie: "booked",
      }),
    ).toBe("Umzug · Stuttgart-Ost → Fellbach · Fr 13.11.");

    expect(
      wasZeile({
        art: "Umzug",
        von: "Stuttgart-Ost",
        nach: null,
        termin: "2026-11-13",
        kategorie: "booked",
      }),
    ).toBe("Umzug · Stuttgart-Ost · Fr 13.11.");

    expect(
      wasZeile({
        art: "Entrümpelung",
        von: "Fellbach",
        nach: "Fellbach",
        termin: "2026-11-28",
        kategorie: "quoted",
      }),
    ).toBe("Entrümpelung · Fellbach · 28.11.");

    expect(
      wasZeile({
        art: "Umzug",
        von: "Stuttgart-Ost",
        nach: "Fellbach",
        termin: null,
        kategorie: "booked",
      }),
    ).toBe("Umzug · Stuttgart-Ost → Fellbach");
  });
});

describe("vorText", () => {
  it("gerade eben, Minuten, Stunden, gestern, Tage, leer ohne Zeitpunkt", () => {
    expect(vorText(null, JETZT)).toBe("");
    expect(vorText("kein-datum", JETZT)).toBe("");
    expect(vorText(vor(0), JETZT)).toBe("gerade eben");
    expect(vorText(vor(35), JETZT)).toBe("vor 35 Min");
    expect(vorText(vor(3 * 60), JETZT)).toBe("vor 3 Std");
    expect(vorText(vor(TAG), JETZT)).toBe("gestern");
    expect(vorText(vor(4 * TAG), JETZT)).toBe("vor 4 Tagen");
  });
});

describe("wocheGrenzen", () => {
  it("Montag, Sonntag, Jahreswechsel und Sommerzeitwechsel in Berlin", () => {
    expect(wocheGrenzen(new Date("2026-11-02T11:00:00.000Z"))).toEqual({ von: "2026-11-02", bis: "2026-11-08" });
    expect(wocheGrenzen(new Date("2026-11-08T11:00:00.000Z"))).toEqual({ von: "2026-11-02", bis: "2026-11-08" });
    // Montag 00:30 Berlin ist in UTC noch Sonntag.
    expect(wocheGrenzen(new Date("2025-12-28T23:30:00.000Z"))).toEqual({ von: "2025-12-29", bis: "2026-01-04" });
    expect(wocheGrenzen(new Date("2026-01-01T11:00:00.000Z"))).toEqual({ von: "2025-12-29", bis: "2026-01-04" });
    expect(wocheGrenzen(new Date("2026-01-04T11:00:00.000Z"))).toEqual({ von: "2025-12-29", bis: "2026-01-04" });
    // Sonntag 00:30 der Umstellung und Montag 00:30 danach (UTC liegt im Vortag).
    expect(wocheGrenzen(new Date("2026-03-28T23:30:00.000Z"))).toEqual({ von: "2026-03-23", bis: "2026-03-29" });
    expect(wocheGrenzen(new Date("2026-03-29T22:30:00.000Z"))).toEqual({ von: "2026-03-30", bis: "2026-04-05" });
  });
});

describe("monatsOptionen", () => {
  it("Jahreswechsel: vergangenes Jahr mit Jahreszahl, laufendes Jahr ohne", () => {
    expect(monatsOptionen(new Date("2026-01-15T11:00:00.000Z"))).toEqual([
      { wert: "2025-10", label: "Oktober 2025" },
      { wert: "2025-11", label: "November 2025" },
      { wert: "2025-12", label: "Dezember 2025" },
      { wert: "2026-01", label: "Januar" },
      { wert: "2026-02", label: "Februar" },
      { wert: "2026-03", label: "März" },
      { wert: "2026-04", label: "April" },
      { wert: "2026-05", label: "Mai" },
      { wert: "2026-06", label: "Juni" },
      { wert: "2026-07", label: "Juli" },
      { wert: "2026-08", label: "August" },
      { wert: "2026-09", label: "September" },
      { wert: "2026-10", label: "Oktober" },
    ]);
  });
});

const GUELTIG = {
  modus: "liste" as const,
  listenSpalten: ["name", "stufe", "betrag"] as const,
  sortierung: { schluessel: "termin" as const, richtung: "auf" as const },
};

describe("leadsAnsichtPruefen und leadsAnsichtAus", () => {
  it("gültige Ansicht, fremde Felder fallen weg", () => {
    const roh = { ...GUELTIG, listenSpalten: ["betrag", "name"], modus: "kalender", notiz: "weg" };
    const sauber = {
      modus: "kalender" as const,
      listenSpalten: ["betrag", "name"],
      sortierung: { schluessel: "betrag" as const, richtung: "auf" as const },
    };
    expect(
      leadsAnsichtPruefen({ ...roh, sortierung: { ...sauber.sortierung, extra: true } }),
    ).toEqual(sauber);
    expect(leadsAnsichtAus({ ...roh, sortierung: { schluessel: "quelle", richtung: "ab", extra: true } })).toEqual({
      modus: "kalender",
      listenSpalten: ["betrag", "name"],
      sortierung: { schluessel: "quelle", richtung: "ab" },
    });
  });

  it("doppelte Spalten: Prüfung lehnt ab, Lesen entdoppelt", () => {
    const roh = { ...GUELTIG, listenSpalten: ["name", "stufe", "name"] };
    expect(leadsAnsichtPruefen(roh)).toBeNull();
    expect(leadsAnsichtAus(roh).listenSpalten).toEqual(["name", "stufe"]);
  });

  it("ohne name: Prüfung lehnt ab, Lesen stellt name voran", () => {
    const roh = { ...GUELTIG, listenSpalten: ["termin", "firma", "termin"] };
    expect(leadsAnsichtPruefen(roh)).toBeNull();
    expect(leadsAnsichtAus(roh)).toEqual({
      modus: "liste",
      listenSpalten: ["name", "termin", "firma"],
      sortierung: GUELTIG.sortierung,
    });
  });

  it("falscher Modus: Prüfung lehnt ab, Lesen fällt auf Board zurück", () => {
    const roh = { ...GUELTIG, modus: "raster" };
    expect(leadsAnsichtPruefen(roh)).toBeNull();
    expect(leadsAnsichtAus(roh)).toEqual({ ...GUELTIG, modus: "board", listenSpalten: [...GUELTIG.listenSpalten] });
  });

  it("leere, unbekannte und zu lange Spalten sowie kaputte Sortierung", () => {
    expect(leadsAnsichtPruefen(null)).toBeNull();
    expect(leadsAnsichtPruefen([])).toBeNull();
    expect(leadsAnsichtPruefen({ ...GUELTIG, listenSpalten: [] })).toBeNull();
    expect(leadsAnsichtPruefen({ ...GUELTIG, listenSpalten: ["name", "unbekannt"] })).toBeNull();
    expect(
      leadsAnsichtPruefen({
        ...GUELTIG,
        listenSpalten: Array.from({ length: LISTEN_SPALTEN.length + 1 }, () => "name"),
      }),
    ).toBeNull();
    expect(leadsAnsichtPruefen({ ...GUELTIG, sortierung: { schluessel: "name", richtung: "auf" } })).toBeNull();
    expect(leadsAnsichtPruefen({ ...GUELTIG, sortierung: { schluessel: "wartezeit", richtung: "desc" } })).toBeNull();

    expect(leadsAnsichtAus(null)).toEqual(STANDARD_ANSICHT);
    expect(leadsAnsichtAus({ listenSpalten: ["foo"], sortierung: { schluessel: "preis" } })).toEqual(STANDARD_ANSICHT);
  });
});

describe("filterAusParams und filterZuParams", () => {
  it("Rundlauf, leere Werte entfallen", () => {
    const filter: LeadsFilter = {
      chip: "ohne_team",
      firmaId: "f-kottke",
      quelleId: "src-kleinanzeigen",
      monat: "2027-01",
      suche: "  Müller  ",
      nurWartet: true,
      endstufen: true,
    };
    const params = filterZuParams(filter);
    expect(params.get("chip")).toBe("ohne_team");
    expect(params.get("firma")).toBe("f-kottke");
    expect(params.get("quelle")).toBe("src-kleinanzeigen");
    expect(params.get("monat")).toBe("2027-01");
    expect(params.get("q")).toBe("Müller");
    expect(params.get("nur")).toBe("uns");
    expect(params.get("alle")).toBe("1");
    expect(filterAusParams(params)).toEqual({ ...filter, suche: "Müller" });
    expect([...filterZuParams(LEERER_FILTER).keys()]).toEqual([]);
    expect(filterAusParams(filterZuParams(LEERER_FILTER))).toEqual(LEERER_FILTER);
  });

  it("ungültiger Monat und Chip fallen weg, Unbekanntes wird ignoriert", () => {
    const params = new URLSearchParams("chip=heute&monat=2026-13&nur=ja&alle=true&firma=&q=Nord&modus=liste");
    expect(filterAusParams(params)).toEqual({ ...LEERER_FILTER, suche: "Nord" });
    expect(filterAusParams(new URLSearchParams("chip=Warten&monat=2026-1")).chip).toBeNull();
    expect(filterAusParams(new URLSearchParams("chip=Warten&monat=2026-1")).monat).toBeNull();
    expect(filterAusParams(new URLSearchParams("chip=diese_woche&monat=2026-12"))).toMatchObject({
      chip: "diese_woche",
      monat: "2026-12",
    });
    expect(filterAusParams(new URLSearchParams({ q: "a".repeat(250) })).suche).toHaveLength(200);
  });
});

describe("sortierungAusParams", () => {
  const rueckfall: ListenSortierung = { schluessel: "wartezeit", richtung: "ab" };

  it("gültige Paare, sonst die Rückfallebene", () => {
    expect(sortierungAusParams(new URLSearchParams("sort=termin&richtung=auf"), rueckfall)).toEqual({
      schluessel: "termin",
      richtung: "auf",
    });
    expect(sortierungAusParams(new URLSearchParams("sort=betrag&richtung=ab"), rueckfall)).toEqual({
      schluessel: "betrag",
      richtung: "ab",
    });
    expect(sortierungAusParams(new URLSearchParams("sort=preis&richtung=ab"), rueckfall)).toEqual(rueckfall);
    expect(sortierungAusParams(new URLSearchParams("sort=stufe&richtung=desc"), rueckfall)).toEqual(rueckfall);
    expect(sortierungAusParams(new URLSearchParams("sort=quelle"), rueckfall)).toEqual(rueckfall);
    expect(sortierungAusParams(new URLSearchParams(), rueckfall)).toEqual(rueckfall);
  });
});

describe("chipText", () => {
  it("Einzahl und Mehrzahl", () => {
    const faelle: Record<LeadsChipKey, { eins: string; viele: string }> = {
      warten: { eins: "wartet auf uns", viele: "warten auf uns" },
      kv_ungesehen: {
        eins: "KV seit über 3 Tagen ungesehen",
        viele: "KV seit über 3 Tagen ungesehen",
      },
      ohne_team: { eins: "Termin ohne Team", viele: "Termine ohne Team" },
      rechnung_offen: { eins: "Rechnung offen", viele: "Rechnungen offen" },
      ohne_ab: { eins: "angenommen, keine AB", viele: "angenommen, keine AB" },
      diese_woche: { eins: "Umzug diese Woche", viele: "Umzüge diese Woche" },
    };
    for (const [key, text] of Object.entries(faelle) as [LeadsChipKey, { eins: string; viele: string }][]) {
      expect(chipText(key, 1)).toBe(text.eins);
      expect(chipText(key, 2)).toBe(text.viele);
      expect(chipText(key, 0)).toBe(text.viele);
    }
  });
});

describe("firmenPunktFarbe", () => {
  it("Kottke tinte, Ceylan rot, sonst grau", () => {
    expect(firmenPunktFarbe("Kottke")).toBe("#222224");
    expect(firmenPunktFarbe("Umzüge Kottke GmbH")).toBe("#222224");
    expect(firmenPunktFarbe("CEYLAN")).toBe("#c9361a");
    expect(firmenPunktFarbe("Ceylan Transport")).toBe("#c9361a");
    expect(firmenPunktFarbe("Kottke & Ceylan")).toBe("#222224");
    expect(firmenPunktFarbe("Meyer")).toBe("#8e8e93");
    expect(firmenPunktFarbe(null)).toBe("#8e8e93");
    expect(firmenPunktFarbe("")).toBe("#8e8e93");
  });
});

describe("kategorieRang", () => {
  it("Board von 0 bis 5, Endstufen und leer ohne Rang", () => {
    expect(kategorieRang("open_new")).toBe(0);
    expect(kategorieRang("open_engaged")).toBe(1);
    expect(kategorieRang("quoted")).toBe(2);
    expect(kategorieRang("booked")).toBe(3);
    expect(kategorieRang("done_unpaid")).toBe(4);
    expect(kategorieRang("paid")).toBe(5);
    expect(kategorieRang("lost")).toBeNull();
    expect(kategorieRang("kein_lead")).toBeNull();
    expect(kategorieRang(null)).toBeNull();
  });
});

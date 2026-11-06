import { describe, expect, it } from "vitest";
import {
  BOARD_SEITE,
  LEERER_FILTER,
  OHNE_STUFE,
  STANDARD_ANSICHT,
  type LeadKarte,
  type LeadSpalte,
  type LeadsBoard,
  type LeadsFilter,
} from "@/lib/leads-board";
import {
  ablageTexte,
  angezeigterModus,
  ansichtAendern,
  antwortFolge,
  bezahltRueckfrageText,
  boardUrl,
  eingeklapptText,
  filterAktiv,
  handyUnterzeile,
  karteFinden,
  kartenMischen,
  ladeSchluessel,
  leadsUrl,
  leereSendeschlange,
  leerText,
  listeUrl,
  listenUnterzeile,
  mehrErlaubt,
  menueZiele,
  modusAnzeige,
  nachZahlungFolge,
  nachladeLimits,
  nachladen,
  seitenEinsetzen,
  sendenAnfragen,
  sendenFertig,
  sichtbareSpalten,
  sortSchluessel,
  sortierungKlick,
  spalteUmschalten,
  spalteUrl,
  spaltenLimit,
  spaltenNachAktion,
  streckeText,
  sucheWirksam,
  terminFehlt,
  zellenText,
  zugBauen,
} from "./leads-logik";

const S_NEU = "s-neu";
const S_KONTAKT = "s-kontakt";
const S_ANGEBOT = "s-angebot";
const S_GEPLANT = "s-geplant";
const S_VERLOREN = "s-verloren";

function karte(teil: Partial<LeadKarte> & { id: string }): LeadKarte {
  return {
    nummer: "U-2026-0042",
    name: "Familie Weber",
    stufe: { id: S_NEU, label: "Neue Anfrage", kategorie: "open_new" },
    spalteId: S_NEU,
    betrag: { cent: 190000, art: "geschaetzt" },
    betragText: "~1.900 €",
    art: "Umzug",
    von: "Stuttgart-Ost",
    nach: "Fellbach",
    termin: "2026-11-28",
    was: "Umzug · Stuttgart-Ost → Fellbach · 28.11.",
    wartet: { auf: "uns", seit: "2026-11-06T10:00:00.000Z", text: "Wartet auf uns · 35 Min", ton: "gold" },
    quelle: { id: "q-ka", label: "Kleinanzeigen" },
    firma: { id: "f-k", name: "Kottke Umzüge", farbe: "#222224" },
    team: [],
    teamFehlt: false,
    kontext: null,
    aktivitaet: "2026-11-06T10:00:00.000Z",
    aktivitaetText: "vor 35 Min",
    zahlungGemeldet: null,
    fakten: { annahmeAm: null, kvVorhanden: false, verlustGrund: null },
    kvLink: "/app/leads/d1/kalkulation",
    erstelltAm: "2026-11-01T08:00:00.000Z",
    ...teil,
  };
}

function spalte(teil: Partial<LeadSpalte> & { stufeId: string }): LeadSpalte {
  return {
    label: "Neue Anfrage",
    kategorie: "open_new",
    ton: "blau",
    satz: "Wartet auf erste Antwort",
    anzahl: 0,
    summeCent: null,
    summeGeschaetzt: false,
    karten: [],
    weiter: null,
    eingeklappt: false,
    ...teil,
  };
}

const STUFEN = [
  { id: S_NEU, label: "Neue Anfrage", kategorie: "open_new" as const },
  { id: S_KONTAKT, label: "In Kontakt", kategorie: "open_engaged" as const },
  { id: S_ANGEBOT, label: "Angebot", kategorie: "quoted" as const },
  { id: S_GEPLANT, label: "Geplant", kategorie: "booked" as const },
  { id: S_VERLOREN, label: "Verloren", kategorie: "lost" as const },
];

describe("Ansicht", () => {
  it("zeigt Board, Liste und Kalender, Unbekanntes als Board", () => {
    expect(modusAnzeige({ modus: "kalender" })).toBe("kalender");
    expect(modusAnzeige({ modus: "liste" })).toBe("liste");
    expect(modusAnzeige({ modus: "board" })).toBe("board");
    expect(modusAnzeige({ modus: "tafel" as never })).toBe("board");
  });

  it("ordnet Spalten wie LISTEN_SPALTEN und hält „name“", () => {
    const a = ansichtAendern(STANDARD_ANSICHT, { listenSpalten: ["termin", "stufe", "termin"] });
    expect(a.listenSpalten).toEqual(["name", "stufe", "termin"]);
  });

  it("schaltet Spalten um, „name“ nicht", () => {
    const ohne = spalteUmschalten(STANDARD_ANSICHT, "quelle");
    expect(ohne.listenSpalten).not.toContain("quelle");
    const mit = spalteUmschalten(ohne, "quelle");
    expect(mit.listenSpalten).toEqual(STANDARD_ANSICHT.listenSpalten);
    expect(spalteUmschalten(STANDARD_ANSICHT, "name")).toBe(STANDARD_ANSICHT);
  });

  it("dreht die Richtung beim zweiten Klick, neuer Schlüssel mit Standardrichtung", () => {
    const a = sortierungKlick(STANDARD_ANSICHT, "termin");
    expect(a.sortierung).toEqual({ schluessel: "termin", richtung: "auf" });
    expect(sortierungKlick(a, "termin").sortierung).toEqual({ schluessel: "termin", richtung: "ab" });
    expect(sortierungKlick(a, "wartezeit").sortierung).toEqual({ schluessel: "wartezeit", richtung: "ab" });
  });

  it("kennt die sortierbaren Spalten", () => {
    expect(sortSchluessel("wartet")).toBe("wartezeit");
    expect(sortSchluessel("stufe")).toBe("stufe");
    expect(sortSchluessel("name")).toBeNull();
    expect(sortSchluessel("team")).toBeNull();
  });
});

describe("Filter und URLs", () => {
  it("sendet die Suche erst ab zwei Zeichen", () => {
    expect(sucheWirksam(" W ")).toBe("");
    expect(sucheWirksam(" We ")).toBe("We");
  });

  it("baut die Seiten-URL ohne leere Werte", () => {
    expect(leadsUrl(LEERER_FILTER)).toBe("/app/leads");
    expect(leadsUrl({ ...LEERER_FILTER, chip: "warten", nurWartet: true })).toBe("/app/leads?chip=warten&nur=uns");
  });

  it("baut die Routen-URLs mit wirksamer Suche", () => {
    const f: LeadsFilter = { ...LEERER_FILTER, suche: "W", firmaId: "f-k" };
    expect(boardUrl(f)).toBe("/api/v1/leads/board?firma=f-k");
    expect(spalteUrl({ ...f, suche: "We" }, S_NEU, 40)).toBe("/api/v1/leads/board/spalte?firma=f-k&q=We&stufe=s-neu&offset=40");
    expect(spalteUrl(LEERER_FILTER, S_NEU, 0, 120)).toBe("/api/v1/leads/board/spalte?stufe=s-neu&offset=0&limit=120");
    expect(listeUrl(LEERER_FILTER, { schluessel: "termin", richtung: "auf" }, 50)).toBe(
      "/api/v1/leads/liste?sort=termin&richtung=auf&offset=50"
    );
  });

  it("zählt endstufen nicht als Filter", () => {
    expect(filterAktiv(LEERER_FILTER)).toBe(false);
    expect(filterAktiv({ ...LEERER_FILTER, endstufen: true })).toBe(false);
    expect(filterAktiv({ ...LEERER_FILTER, monat: "2026-11" })).toBe(true);
    expect(filterAktiv({ ...LEERER_FILTER, suche: "W" })).toBe(false);
  });
});

describe("Spalten", () => {
  const spalten = [
    spalte({ stufeId: OHNE_STUFE, label: "Ohne Stufe", kategorie: null }),
    spalte({ stufeId: S_NEU, anzahl: 2 }),
    spalte({ stufeId: S_VERLOREN, label: "Verloren", kategorie: "lost", anzahl: 6, eingeklappt: true }),
    spalte({ stufeId: "s-kein", label: "Kein Lead", kategorie: "kein_lead", anzahl: 11, eingeklappt: true }),
  ];

  it("zeigt „Ohne Stufe“ nur mit Karten und nichts Eingeklapptes", () => {
    expect(sichtbareSpalten(spalten).map((s) => s.stufeId)).toEqual([S_NEU]);
    const mitOhne = [{ ...spalten[0], anzahl: 1 }, ...spalten.slice(1)];
    expect(sichtbareSpalten(mitOhne).map((s) => s.stufeId)).toEqual([OHNE_STUFE, S_NEU]);
  });

  it("formuliert die Zeile der eingeklappten Spalten", () => {
    expect(eingeklapptText(spalten)).toBe("Verloren (6) und Kein Lead (11) sind ausgeblendet");
    expect(eingeklapptText(spalten.slice(0, 3))).toBe("Verloren (6) ist ausgeblendet");
    expect(eingeklapptText(spalten.slice(0, 2))).toBeNull();
  });

  it("lädt nach, ohne Karten zu wiederholen", () => {
    const sp = spalte({ stufeId: S_NEU, karten: [karte({ id: "a" }), karte({ id: "b" })], weiter: 2, anzahl: 4 });
    const neu = nachladen(sp, { stufeId: S_NEU, karten: [karte({ id: "b" }), karte({ id: "c" })], weiter: null, anzahl: 3 });
    expect(neu.karten.map((k) => k.id)).toEqual(["a", "b", "c"]);
    expect(neu.weiter).toBeNull();
    expect(neu.anzahl).toBe(3);
    expect(kartenMischen([], [karte({ id: "x" })]).length).toBe(1);
  });

  it("hält beim Neuladen die Zahl der geladenen Karten, gekappt", () => {
    expect(spaltenLimit(3)).toBe(BOARD_SEITE);
    expect(spaltenLimit(120)).toBe(120);
    expect(spaltenLimit(900)).toBe(400);
    const viele = Array.from({ length: 80 }, (_, i) => karte({ id: `k${i}` }));
    const sp = [spalte({ stufeId: S_NEU, karten: viele }), spalte({ stufeId: S_KONTAKT, karten: viele.slice(0, 10) })];
    expect(nachladeLimits(sp)).toEqual([{ stufeId: S_NEU, limit: 80 }]);
  });

  it("setzt längere Seiten ins frische Board ein", () => {
    const board: LeadsBoard = {
      spalten: [spalte({ stufeId: S_NEU, karten: [karte({ id: "a" })], weiter: 40, anzahl: 80 }), spalte({ stufeId: S_KONTAKT })],
      chips: { warten: 0, kv_ungesehen: 0, ohne_team: 0, rechnung_offen: 0, diese_woche: 0 },
      stand: "2026-11-06T10:00:00.000Z",
      firmen: [],
      quellen: [],
      stufen: [],
      verlustGruende: [],
    };
    const neu = seitenEinsetzen(board, [{ stufeId: S_NEU, karten: [karte({ id: "a" }), karte({ id: "b" })], weiter: null, anzahl: 2 }]);
    expect(neu.spalten[0].karten.length).toBe(2);
    expect(neu.spalten[0].weiter).toBeNull();
    expect(neu.spalten[1]).toBe(board.spalten[1]);
    expect(seitenEinsetzen(board, [])).toBe(board);
  });

  it("nennt die Spalten, die nach einem Zug neu laden", () => {
    expect(spaltenNachAktion(S_NEU, S_KONTAKT)).toEqual([S_NEU, S_KONTAKT]);
    expect(spaltenNachAktion(S_NEU, S_NEU)).toEqual([S_NEU]);
    expect(spaltenNachAktion(OHNE_STUFE, S_NEU)).toEqual([OHNE_STUFE, S_NEU]);
  });

  it("findet eine Karte samt Spalte", () => {
    const sp = [spalte({ stufeId: S_NEU }), spalte({ stufeId: S_KONTAKT, karten: [karte({ id: "a" })] })];
    expect(karteFinden(sp, "a")?.spalte.stufeId).toBe(S_KONTAKT);
    expect(karteFinden(sp, "zz")).toBeNull();
  });

  it("kennt den Leerzustand", () => {
    const leer = [spalte({ stufeId: S_NEU })];
    expect(leerText(leer, LEERER_FILTER)).toBe("keine");
    expect(leerText(leer, { ...LEERER_FILTER, chip: "warten" })).toBe("treffer");
    expect(leerText([spalte({ stufeId: S_NEU, anzahl: 1 })], LEERER_FILTER)).toBeNull();
  });
});

describe("Züge", () => {
  const spalten = [
    spalte({ stufeId: OHNE_STUFE, label: "Ohne Stufe", kategorie: null }),
    spalte({ stufeId: S_NEU }),
    spalte({ stufeId: S_KONTAKT, label: "In Kontakt", kategorie: "open_engaged" }),
    spalte({ stufeId: S_ANGEBOT, label: "Angebot", kategorie: "quoted" }),
    spalte({ stufeId: S_VERLOREN, label: "Verloren", kategorie: "lost", eingeklappt: true }),
  ];

  it("gibt je Spalte den Ablagetext der gezogenen Karte", () => {
    const t = ablageTexte(karte({ id: "a" }), spalten);
    expect(t.get(OHNE_STUFE)).toBeNull();
    expect(t.get(S_NEU)).toBeNull();
    expect(t.get(S_KONTAKT)).toBe("Hierher ziehen = Stufe setzen");
    expect(t.get(S_ANGEBOT)).toBe("Hierher ziehen = KV erstellen");
    expect(t.get(S_VERLOREN)).toBe("Hierher ziehen = Als verloren markieren");
  });

  it("baut den Zug oder nichts bei gleicher Spalte", () => {
    const k = karte({ id: "a" });
    const von = { stufeId: S_NEU, kategorie: "open_new" as const, label: "Neue Anfrage" };
    expect(zugBauen(k, von, von)).toBeNull();
    expect(zugBauen(k, von, { stufeId: OHNE_STUFE, kategorie: null, label: "Ohne Stufe" })).toBeNull();
    const z = zugBauen(k, von, { stufeId: S_ANGEBOT, kategorie: "quoted", label: "Angebot" });
    expect(z?.aktion).toEqual({ art: "kv" });
    expect(z?.nach.label).toBe("Angebot");
  });

  it("baut die Ziele des Kartenmenüs ohne die eigene Spalte", () => {
    const z = menueZiele(karte({ id: "a" }), STUFEN);
    expect(z.map((x) => x.stufe.id)).toEqual([S_KONTAKT, S_ANGEBOT, S_GEPLANT, S_VERLOREN]);
    expect(z[1].aktion).toEqual({ art: "kv" });
    expect(z[2].aktion).toEqual({ art: "beauftragung" });
    expect(z[3].aktion).toEqual({ art: "verlustgrund" });
  });

  it("lässt eine Karte ohne Stufe überall hin, auch per Menü", () => {
    const ohne = karte({ id: "o", spalteId: OHNE_STUFE, stufe: { id: null, label: "Ohne Stufe", kategorie: null } });
    const z = menueZiele(ohne, STUFEN);
    expect(z.map((x) => x.stufe.id)).toEqual([S_NEU, S_KONTAKT, S_ANGEBOT, S_GEPLANT, S_VERLOREN]);
    expect(z[0].aktion).toEqual({ art: "setzen" });
  });

  it("entscheidet nach dem Zahlungsdialog (Entscheidung 4)", () => {
    expect(nachZahlungFolge({ gebucht: true, vonKategorie: "done_unpaid", neueKategorie: "paid", restCent: 0 })).toEqual({ art: "bleibt" });
    expect(nachZahlungFolge({ gebucht: false, vonKategorie: "done_unpaid", neueKategorie: "done_unpaid", restCent: 0 })).toEqual({
      art: "rueckfrage",
    });
    expect(nachZahlungFolge({ gebucht: true, vonKategorie: "done_unpaid", neueKategorie: "done_unpaid", restCent: null })).toEqual({
      art: "rueckfrage",
    });
    expect(nachZahlungFolge({ gebucht: true, vonKategorie: "done_unpaid", neueKategorie: "done_unpaid", restCent: 160000 })).toEqual({
      art: "toast",
      text: "Zahlung gebucht, Rest 1.600 € offen. Die Stufe bleibt.",
    });
    expect(nachZahlungFolge({ gebucht: true, vonKategorie: "booked", neueKategorie: "booked", restCent: 0 })).toEqual({
      art: "toast",
      text: "Zahlung gebucht. Die Stufe bleibt.",
    });
    expect(nachZahlungFolge({ gebucht: false, vonKategorie: "booked", neueKategorie: "booked", restCent: 500 })).toEqual({ art: "nichts" });
  });

  it("formuliert die Rückfrage nach dem Zahlungsdialog", () => {
    expect(bezahltRueckfrageText(0, "Bezahlt").titel).toBe("Auf „Bezahlt“ setzen?");
    expect(bezahltRueckfrageText(null, "Bezahlt").text).toContain("unbekannt");
  });

  it("meldet den fehlenden Termin nur nach Geplant", () => {
    expect(terminFehlt({ termin: null }, "booked", true)).toBe(true);
    expect(terminFehlt({ termin: "2026-11-14" }, "booked", true)).toBe(false);
    expect(terminFehlt({ termin: null }, "open_engaged", true)).toBe(false);
    expect(terminFehlt({ termin: null }, "booked", false)).toBe(false);
  });
});

describe("Texte", () => {
  it("Unterzeile am Handy", () => {
    expect(handyUnterzeile({ warten: 1, kv_ungesehen: 0, ohne_team: 0, rechnung_offen: 0, diese_woche: 0 })).toBe("1 wartet auf uns");
    expect(handyUnterzeile({ warten: 4, kv_ungesehen: 0, ohne_team: 0, rechnung_offen: 0, diese_woche: 0 })).toBe("4 warten auf uns");
  });

  it("Strecke und Zellen der Liste", () => {
    const k = karte({ id: "a", team: [{ kuerzel: "MK", name: "M. K." }], teamFehlt: true });
    expect(streckeText(k)).toBe("Stuttgart-Ost → Fellbach");
    expect(streckeText({ von: "Esslingen", nach: "Esslingen" })).toBe("Esslingen");
    expect(streckeText({ von: null, nach: null })).toBe("");
    expect(zellenText(k, "termin")).toBe("Sa 28.11.");
    expect(zellenText(k, "team")).toBe("MK");
    expect(zellenText({ ...k, stufe: { id: S_GEPLANT, label: "Geplant", kategorie: "booked" } }, "team")).toBe("MK ?");
    expect(zellenText(k, "erstellt")).toBe("01.11.");
    expect(zellenText(k, "nummer")).toBe("U-2026-0042");
    expect(zellenText({ ...k, wartet: { ...k.wartet, text: null } }, "wartet")).toBe("");
  });

  it("Unterzeile der Liste", () => {
    expect(listenUnterzeile(0)).toBe("Keine Leads");
    expect(listenUnterzeile(1)).toBe("1 Lead");
    expect(listenUnterzeile(37)).toBe("37 Leads");
  });
});

describe("Laden", () => {
  it("zeigt am Handy immer die Kartenliste, sonst die gespeicherte Ansicht", () => {
    const liste = { ...STANDARD_ANSICHT, modus: "liste" as const };
    expect(angezeigterModus(false, liste)).toBe("board");
    expect(angezeigterModus(true, liste)).toBe("liste");
    // Kalender: Board-Daten für Chips, Firmen und Quellen (der Plan lädt seine Einträge selbst); am Handy die Kartenliste
    expect(angezeigterModus(true, { modus: "kalender" })).toBe("board");
    expect(angezeigterModus(false, { modus: "kalender" })).toBe("board");
    expect(angezeigterModus(true, { ...STANDARD_ANSICHT, modus: "kalender" })).toBe("board");
    expect(angezeigterModus(null, liste)).toBeNull();
    expect(angezeigterModus(true, null)).toBeNull();
  });

  it("bindet den Ladeschlüssel an Modus, gesendeten Filter und bei der Liste an die Sortierung", () => {
    const s = STANDARD_ANSICHT.sortierung;
    const b = ladeSchluessel("board", LEERER_FILTER, s);
    expect(ladeSchluessel("board", { ...LEERER_FILTER, suche: "a" }, s)).toBe(b);
    expect(ladeSchluessel("board", LEERER_FILTER, { schluessel: "betrag", richtung: "ab" })).toBe(b);
    expect(ladeSchluessel("board", { ...LEERER_FILTER, chip: "warten" }, s)).not.toBe(b);
    expect(ladeSchluessel("liste", LEERER_FILTER, s)).not.toBe(b);
    expect(ladeSchluessel("liste", LEERER_FILTER, { schluessel: "betrag", richtung: "ab" })).not.toBe(ladeSchluessel("liste", LEERER_FILTER, s));
  });

  it("sperrt „Mehr laden“ während des Neuladens und bei fremdem Filter", () => {
    expect(mehrErlaubt({ laeuft: false, geladenFuer: "a", aktuell: "a" })).toBe(true);
    expect(mehrErlaubt({ laeuft: true, geladenFuer: "a", aktuell: "a" })).toBe(false);
    expect(mehrErlaubt({ laeuft: false, geladenFuer: "a", aktuell: "b" })).toBe(false);
    expect(mehrErlaubt({ laeuft: false, geladenFuer: null, aktuell: "a" })).toBe(false);
  });

  it("verwirft alte Läufe und fremde Filter, holt nach, solange gezogen wird oder ein Dialog offen ist", () => {
    const basis = { lauf: 3, aktuell: 3, geladenFuer: "a", erwartet: "a", pausiert: false, angezeigt: true };
    expect(antwortFolge(basis)).toBe("anwenden");
    expect(antwortFolge({ ...basis, aktuell: 4 })).toBe("verwerfen");
    expect(antwortFolge({ ...basis, erwartet: "b" })).toBe("verwerfen");
    expect(antwortFolge({ ...basis, pausiert: true })).toBe("nachholen");
    // Das erste Laden wartet nie.
    expect(antwortFolge({ ...basis, pausiert: true, angezeigt: false })).toBe("anwenden");
  });

  it("schickt Ansichten nacheinander, nur der neueste wartende Wert geht danach raus", () => {
    let r = sendenAnfragen(leereSendeschlange<string>(), "a");
    expect(r.jetzt).toBe("a");
    r = sendenAnfragen(r.z, "b");
    expect(r.jetzt).toBeNull();
    r = sendenAnfragen(r.z, "c");
    expect(r.z).toEqual({ laeuft: true, wartend: "c" });
    const f1 = sendenFertig(r.z);
    expect(f1).toEqual({ z: { laeuft: true, wartend: null }, jetzt: "c", veraltet: true });
    const f2 = sendenFertig(f1.z);
    expect(f2).toEqual({ z: { laeuft: false, wartend: null }, jetzt: null, veraltet: false });
  });
});

describe("Zahlung im Zug", () => {
  it("bietet ohne lesbare Zahlungsdaten keine Rückfrage an", () => {
    expect(nachZahlungFolge({ gebucht: false, vonKategorie: "done_unpaid", neueKategorie: "done_unpaid", restCent: null, fehler: true })).toEqual({
      art: "fehler",
    });
  });
});

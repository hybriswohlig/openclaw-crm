import { describe, it, expect } from "vitest";
import { MONTAGE_KEY, positionSchluessel } from "./kalkulation-versionen";
import {
  VORSCHLAEGE_MAX,
  aenderungsGrund,
  aenderungsStand,
  herkunftAus,
  kundenNachricht,
  normalisiereVorschlaege,
  uebernahmePlan,
  type Aenderung,
  type AenderungsEreignis,
  type AenderungsPayload,
  type InventarZeile,
  type Vorschlag,
  type VorschlagQuelle,
} from "./angebot-aenderung";

const ZEIT = "2026-11-11T10:00:00.000Z";

const inventar: InventarZeile[] = [
  { id: "sch1", name: "Kleiderschrank", quantity: 1, moveFlag: true },
  { id: "so1", name: "Sofa", quantity: 1, moveFlag: true },
  { id: "ti1", name: "Tisch", quantity: 2, moveFlag: true },
];

function vorschlag(
  id: string,
  aenderung: Aenderung,
  extra: Partial<Vorschlag> & { quelle?: VorschlagQuelle } = {}
): Vorschlag {
  return {
    id,
    quelle: extra.quelle ?? "chat",
    aenderung,
    zitat: extra.zitat ?? `Zitat ${id}`,
    status: extra.status ?? "offen",
    zeit: extra.zeit ?? ZEIT,
  };
}

function ereignis(zeit: string, payload: AenderungsPayload): AenderungsEreignis {
  return { zeit, payload };
}

describe("normalisiereVorschlaege", () => {
  it("nimmt jede gültige Art ins Schema und setzt Menge und Größe nach", () => {
    let n = 0;
    const liste = normalisiereVorschlaege(
      [
        { art: "montage", name: "Lampe", abbau: "company", aufbau: "kunde", zitat: "Lampe bauen" },
        { art: "teil_hinzu", name: "Lampe", menge: 2, groesse: "mittel", zitat: "zwei Lampen" },
        { art: "teil_hinzu", name: "Bild", groesse: "riesig", zitat: "ein Bild" },
        { art: "teil_weg", name: "sofa", zitat: "Sofa raus" },
        { art: "teil_menge", name: "Tisch", menge: 4, zitat: "vier Tische" },
        { art: "halteverbot", seite: "einzug", an: false, zitat: "kein Halteverbot" },
        { art: "etage", seite: "auszug", etage: "3", zitat: "dritter Stock" },
        { art: "aufzug", seite: "beladen", aufzug: "groß", zitat: "großer Aufzug" },
        { art: "tragweg", seite: "nach", meter: 12.4, zitat: "zwölf Meter" },
        { art: "termin", datum: "2026-12-01", text: "vormittags", zitat: "am 1. Dezember" },
        { art: "kartons", anzahl: 20, zitat: "20 Kartons" },
        { art: "einpacken", anzahl: 0, zitat: "nicht einpacken" },
        { art: "posten_hinzu", bezeichnung: "Klavier", minuten: 40, zitat: "Klavier 40 Minuten" },
        { art: "posten_hinzu", bezeichnung: "Decken", betrag: 25.126, zitat: "Decken extra" },
        { art: "posten_weg", hebel: "kueche", zitat: "Küche raus" },
        { art: "hinweis", text: "Bitte anrufen", zitat: "Bitte anrufen" },
      ],
      { inventar, quelle: "chat", zeit: ZEIT, id: () => `id-${n++}` }
    );

    expect(liste.map((v) => v.aenderung)).toEqual([
      { art: "montage", name: "Lampe", abbau: "wir", aufbau: "kunde" },
      { art: "teil_hinzu", name: "Lampe", menge: 2, groesse: "mittel" },
      { art: "teil_hinzu", name: "Bild", menge: 1, groesse: null },
      { art: "teil_weg", name: "Sofa" },
      { art: "teil_menge", name: "Tisch", menge: 4 },
      { art: "halteverbot", seite: "entladen", an: false },
      { art: "etage", seite: "beladen", etage: 3 },
      { art: "aufzug", seite: "beladen", aufzug: "gross" },
      { art: "tragweg", seite: "entladen", meter: 12 },
      { art: "termin", datum: "2026-12-01", text: "vormittags" },
      { art: "kartons", anzahl: 20 },
      { art: "einpacken", anzahl: 0 },
      { art: "posten_hinzu", bezeichnung: "Klavier", minuten: 40, betrag: null },
      { art: "posten_hinzu", bezeichnung: "Decken", minuten: null, betrag: 25.13 },
      { art: "posten_weg", hebel: "kueche" },
      { art: "hinweis", text: "Bitte anrufen" },
    ]);
    expect(liste.every((v) => v.quelle === "chat" && v.status === "offen" && v.zeit === ZEIT)).toBe(true);
    expect(liste[0].zitat).toBe("Lampe bauen");
  });

  it("macht Ungültiges zu unklar und behält den Originaltext", () => {
    const liste = normalisiereVorschlaege(
      [
        { art: "teil_hinzu", menge: 2, zitat: "irgendwas dazu" },
        { art: "teil_weg", name: "Xylophon", zitat: "Xylophon bleibt" },
        { art: "teil_menge", name: "Unbekannt", menge: 3, zitat: "drei Unbekannt" },
        { art: "posten_hinzu", bezeichnung: "Beides", minuten: 10, betrag: 5, zitat: "beides angegeben" },
        { art: "quatsch", text: "bitte Fenster putzen" },
      ],
      { inventar, quelle: "eingabe", zeit: ZEIT, id: () => "x", originalText: "ganzer Satz" }
    );

    expect(liste.map((v) => v.aenderung)).toEqual([
      { art: "unklar", text: "irgendwas dazu" },
      { art: "unklar", text: "Xylophon bleibt" },
      { art: "unklar", text: "drei Unbekannt" },
      { art: "unklar", text: "beides angegeben" },
      { art: "unklar", text: "bitte Fenster putzen" },
    ]);

    const ohneFeld = normalisiereVorschlaege([{ art: "hinweis" }], {
      inventar,
      quelle: "bot",
      zeit: ZEIT,
      id: () => "y",
      originalText: "ganzer Satz ohne Feld",
    });
    expect(ohneFeld[0].aenderung).toEqual({ art: "unklar", text: "ganzer Satz ohne Feld" });
    expect(ohneFeld[0].zitat).toBe("ganzer Satz ohne Feld");
  });

  it("lässt teil_weg nur mit bekanntem Inventarnamen zu", () => {
    const bekannt = normalisiereVorschlaege([{ art: "teil_weg", name: "Sofa", zitat: "Sofa raus" }], {
      inventar,
      quelle: "chat",
      zeit: ZEIT,
      id: () => "a",
    });
    const fremd = normalisiereVorschlaege([{ art: "teil_weg", name: "Pflanze", zitat: "Pflanze bleibt" }], {
      inventar,
      quelle: "chat",
      zeit: ZEIT,
      id: () => "b",
    });

    expect(bekannt[0].aenderung).toEqual({ art: "teil_weg", name: "Sofa" });
    expect(fremd[0].aenderung).toEqual({ art: "unklar", text: "Pflanze bleibt" });
  });

  it("trifft Schrank auf Kleiderschrank nur bei genau einem Treffer", () => {
    const einer = normalisiereVorschlaege([{ art: "teil_weg", name: "Schrank", zitat: "der Schrank" }], {
      inventar: [{ id: "sch1", name: "Kleiderschrank", quantity: 1, moveFlag: true }],
      quelle: "chat",
      zeit: ZEIT,
      id: () => "a",
    });
    const zwei = normalisiereVorschlaege([{ art: "teil_menge", name: "Schrank", menge: 2, zitat: "zwei Schränke" }], {
      inventar: [
        { id: "sch1", name: "Kleiderschrank", quantity: 1, moveFlag: true },
        { id: "sch2", name: "Schuhschrank", quantity: 1, moveFlag: true },
      ],
      quelle: "chat",
      zeit: ZEIT,
      id: () => "b",
    });
    const genau = normalisiereVorschlaege([{ art: "teil_weg", name: "Schrank", zitat: "der Schrank" }], {
      inventar: [
        { id: "sch0", name: "Schrank", quantity: 1, moveFlag: true },
        { id: "sch1", name: "Kleiderschrank", quantity: 1, moveFlag: true },
      ],
      quelle: "chat",
      zeit: ZEIT,
      id: () => "c",
    });

    expect(einer[0].aenderung).toEqual({ art: "teil_weg", name: "Kleiderschrank" });
    expect(zwei[0].aenderung).toEqual({ art: "unklar", text: "zwei Schränke" });
    expect(genau[0].aenderung).toEqual({ art: "teil_weg", name: "Schrank" });
  });

  it("erlaubt Montage an einem Teil, das in derselben Liste dazukommt", () => {
    const liste = normalisiereVorschlaege(
      [
        { art: "montage", name: "Fahrrad", abbau: "wir", aufbau: null, zitat: "Fahrrad abbauen" },
        { art: "teil_hinzu", name: "Fahrrad", menge: 1, zitat: "ein Fahrrad" },
      ],
      { inventar: [], quelle: "bot", zeit: ZEIT, id: () => "m" }
    );

    expect(liste.map((v) => v.aenderung)).toEqual([
      { art: "montage", name: "Fahrrad", abbau: "wir", aufbau: null },
      { art: "teil_hinzu", name: "Fahrrad", menge: 1, groesse: null },
    ]);
  });

  it("behält höchstens 40 Vorschläge", () => {
    const roh = Array.from({ length: VORSCHLAEGE_MAX + 5 }, (_, i) => ({
      art: "teil_hinzu",
      name: `Teil ${i}`,
      menge: 1,
    }));
    const liste = normalisiereVorschlaege(roh, { inventar: [], quelle: "chat", zeit: ZEIT, id: () => "n" });

    expect(liste).toHaveLength(VORSCHLAEGE_MAX);
    expect(liste[0].aenderung).toEqual({ art: "teil_hinzu", name: "Teil 0", menge: 1, groesse: null });
    expect(liste[VORSCHLAEGE_MAX - 1].aenderung).toEqual({
      art: "teil_hinzu",
      name: `Teil ${VORSCHLAEGE_MAX - 1}`,
      menge: 1,
      groesse: null,
    });
    expect(normalisiereVorschlaege({ art: "hinweis", text: "nein" }, { inventar: [], quelle: "chat", zeit: ZEIT })).toEqual([]);
  });
});

describe("uebernahmePlan", () => {
  it("baut Lead-Schritte für dazu, Menge und weg mit der Inventar-Id", () => {
    const plan = uebernahmePlan(
      [
        vorschlag("h1", { art: "teil_hinzu", name: "Fahrrad", menge: 2, groesse: "klein" }),
        vorschlag("m1", { art: "teil_menge", name: "Tisch", menge: 5 }),
        vorschlag("w1", { art: "teil_weg", name: "Sofa" }),
      ],
      { inventar, montageJetzt: {} }
    );

    expect(plan.lead).toEqual([
      { art: "hinzu", name: "Fahrrad", menge: 2, groesse: "klein" },
      { art: "menge", id: "ti1", name: "Tisch", menge: 5 },
      { art: "weg", id: "so1", name: "Sofa" },
    ]);
    expect(plan.ids).toEqual(["h1", "m1", "w1"]);
    expect(plan.uebersprungen).toEqual([]);
  });

  it("fasst Montage in eine Übersteuerung und füllt die fehlende Seite aus montageJetzt", () => {
    const sofa = vorschlag("mo1", { art: "montage", name: "Sofa", abbau: "wir", aufbau: "kunde" }, { zitat: "Abbau wir, Aufbau Sie" });
    const tisch = vorschlag("mo2", { art: "montage", name: "Tisch", abbau: null, aufbau: "nicht_noetig" });
    const plan = uebernahmePlan([sofa, tisch], {
      inventar,
      montageJetzt: {
        [positionSchluessel("Sofa")]: { abbau: "kunde", aufbau: "wir" },
        [positionSchluessel("Tisch")]: { abbau: "wir", aufbau: "kunde" },
      },
    });

    expect(plan.uebersteuerungen).toEqual([
      {
        art: "montage",
        key: MONTAGE_KEY,
        wert: {
          positionen: {
            [positionSchluessel("Sofa")]: { abbau: "company", aufbau: "customer" },
            [positionSchluessel("Tisch")]: { abbau: "company", aufbau: "none" },
          },
        },
        grund: aenderungsGrund(sofa),
        herkunft: "chat",
      },
    ]);
    expect(plan.ids).toEqual(["mo1", "mo2"]);
  });

  it("setzt die Schlüssel für Halteverbot, Etage, Kartons und Einpacken", () => {
    const plan = uebernahmePlan(
      [
        vorschlag("hv", { art: "halteverbot", seite: "entladen", an: false }),
        vorschlag("et", { art: "etage", seite: "beladen", etage: 0 }),
        vorschlag("auf", { art: "aufzug", seite: "entladen", aufzug: "klein" }),
        vorschlag("tr", { art: "tragweg", seite: "beladen", meter: 8 }),
        vorschlag("ka", { art: "kartons", anzahl: 15 }),
        vorschlag("ei", { art: "einpacken", anzahl: 8 }),
      ],
      { inventar: [], montageJetzt: {} }
    );

    expect(plan.uebersteuerungen.map((u) => [u.art, u.key, u.wert])).toEqual([
      ["eingabe", "halteverbot.entladen", false],
      ["eingabe", "beladen.etage", 0],
      ["eingabe", "entladen.aufzug", "klein"],
      ["eingabe", "beladen.tragweg", 8],
      ["eingabe", "umzugskartons", 15],
      ["eingabe", "einpacken", 8],
    ]);
  });

  it("legt Zeitposten und freies Material getrennt an", () => {
    const plan = uebernahmePlan(
      [
        vorschlag("zeit-1", { art: "posten_hinzu", bezeichnung: "Wartezeit", minuten: 30, betrag: null }),
        vorschlag("mat-1", { art: "posten_hinzu", bezeichnung: "Folie", minuten: null, betrag: 12.5 }),
      ],
      { inventar: [], montageJetzt: {} }
    );

    expect(plan.uebersteuerungen).toMatchObject([
      { art: "zeitposten", key: "aenderung.zeit1", wert: { bezeichnung: "Wartezeit", minuten: 30 } },
      { art: "material_frei", key: "aenderung.mat1", wert: { bezeichnung: "Folie", betrag: 12.5 } },
    ]);
  });

  it("schaltet beim Hebel Halteverbot beide Seiten aus", () => {
    const eintrag = vorschlag("p1", { art: "posten_weg", hebel: "halteverbot" }, { quelle: "eingabe", zitat: "kein Halteverbot" });
    const plan = uebernahmePlan([eintrag], { inventar: [], montageJetzt: {} });

    expect(plan.uebersteuerungen).toEqual([
      { art: "eingabe", key: "halteverbot.beladen", wert: false, grund: aenderungsGrund(eintrag), herkunft: "eingabe" },
      { art: "eingabe", key: "halteverbot.entladen", wert: false, grund: aenderungsGrund(eintrag), herkunft: "eingabe" },
    ]);
  });

  it("legt Termin und Hinweis nur in die Hinweise und unklar in uebersprungen", () => {
    const plan = uebernahmePlan(
      [
        vorschlag("t1", { art: "termin", datum: "2026-11-20", text: "früher" }),
        vorschlag("h1", { art: "hinweis", text: "Hund ist dabei" }),
        vorschlag("u1", { art: "unklar", text: "bitte das Blaue" }),
      ],
      { inventar: [], montageJetzt: {} }
    );

    expect(plan.lead).toEqual([]);
    expect(plan.uebersteuerungen).toEqual([]);
    expect(plan.hinweise).toEqual([
      "Ihren Terminwunsch (20.11.2026) haben wir notiert; den Termin bestätigen wir Ihnen gesondert.",
      "Hund ist dabei",
    ]);
    expect(plan.ids).toEqual(["t1", "h1"]);
    expect(plan.uebersprungen).toEqual(["u1"]);
  });
});

describe("aenderungsStand", () => {
  const fahrrad: Aenderung = { art: "teil_hinzu", name: "Fahrrad", menge: 1, groesse: null };
  const sofa: Aenderung = { art: "teil_weg", name: "Sofa" };
  const kartons: Aenderung = { art: "kartons", anzahl: 10 };
  const hinweis: Aenderung = { art: "hinweis", text: "alte Idee" };

  it("faltet Ereignisse der Entwurfsversion und ignoriert andere Entwürfe", () => {
    const stand = aenderungsStand(
      [
        ereignis("t0", { typ: "start", entwurfVersion: 4, basisVersion: 2 }),
        ereignis("t1", {
          typ: "vorschlaege",
          entwurfVersion: 4,
          quelle: "chat",
          ersetzen: false,
          stand: "chat-1",
          vorschlaege: [vorschlag("c1", fahrrad)],
        }),
        ereignis("t2", { typ: "eingabe", entwurfVersion: 4, text: "Bitte das Fahrrad" }),
        ereignis("t3", { typ: "start", entwurfVersion: 9, basisVersion: 5 }),
        ereignis("t4", {
          typ: "vorschlaege",
          entwurfVersion: 9,
          quelle: "bot",
          ersetzen: false,
          vorschlaege: [vorschlag("x1", sofa, { quelle: "bot" })],
        }),
        ereignis("t5", { typ: "start", entwurfVersion: 4, basisVersion: 99 }),
        ereignis("t6", {
          typ: "vorschlaege",
          entwurfVersion: 4,
          quelle: "eingabe",
          ersetzen: false,
          stand: "eingabe-1",
          vorschlaege: [vorschlag("e1", kartons, { quelle: "eingabe" })],
        }),
      ],
      4
    );

    expect(stand.gestartet).toBe(true);
    expect(stand.basisVersion).toBe(2);
    expect(stand.entwurfVersion).toBe(4);
    expect(stand.verlauf).toEqual([{ text: "Bitte das Fahrrad", zeit: "t2" }]);
    expect(stand.chatStand).toBe("chat-1");
    expect(stand.eingabeStand).toBe("eingabe-1");
    expect(stand.vorschlaege.map((v) => v.id)).toEqual(["c1", "e1"]);
    expect(aenderungsStand([], null)).toMatchObject({
      entwurfVersion: null,
      basisVersion: null,
      gestartet: false,
      vorschlaege: [],
      verlauf: [],
    });
  });

  it("entfernt beim Ersetzen nur offene Vorschläge derselben Quelle", () => {
    const stand = aenderungsStand(
      [
        ereignis("t0", { typ: "start", entwurfVersion: 4, basisVersion: 2 }),
        ereignis("t1", {
          typ: "vorschlaege",
          entwurfVersion: 4,
          quelle: "chat",
          ersetzen: false,
          vorschlaege: [vorschlag("c1", fahrrad), vorschlag("cOffen", hinweis)],
        }),
        ereignis("t2", { typ: "uebernommen", entwurfVersion: 4, ids: ["c1"] }),
        ereignis("t3", {
          typ: "vorschlaege",
          entwurfVersion: 4,
          quelle: "eingabe",
          ersetzen: false,
          vorschlaege: [vorschlag("e1", kartons, { quelle: "eingabe" })],
        }),
        ereignis("t4", {
          typ: "vorschlaege",
          entwurfVersion: 4,
          quelle: "chat",
          ersetzen: true,
          vorschlaege: [vorschlag("c3", sofa)],
        }),
      ],
      4
    );

    expect(stand.vorschlaege.map((v) => [v.id, v.status, v.quelle])).toEqual([
      ["c1", "uebernommen", "chat"],
      ["e1", "offen", "eingabe"],
      ["c3", "offen", "chat"],
    ]);
  });

  it("übernimmt und verwirft nur offene Einträge und doppelt eine übernommene Änderung nicht", () => {
    const stand = aenderungsStand(
      [
        ereignis("t1", {
          typ: "vorschlaege",
          entwurfVersion: 4,
          quelle: "chat",
          ersetzen: false,
          vorschlaege: [vorschlag("c1", fahrrad), vorschlag("e1", kartons)],
        }),
        ereignis("t2", { typ: "uebernommen", entwurfVersion: 4, ids: ["c1"] }),
        ereignis("t3", { typ: "verworfen", entwurfVersion: 4, ids: ["e1", "c1"] }),
        ereignis("t4", {
          typ: "vorschlaege",
          entwurfVersion: 4,
          quelle: "chat",
          ersetzen: false,
          vorschlaege: [vorschlag("cNeu", { art: "teil_hinzu", name: "fahrrad", menge: 1, groesse: null })],
        }),
        ereignis("t5", { typ: "uebernommen", entwurfVersion: 4, ids: ["fehlt"] }),
      ],
      4
    );

    expect(stand.vorschlaege.map((v) => [v.id, v.status])).toEqual([
      ["c1", "uebernommen"],
      ["e1", "verworfen"],
    ]);
  });
});

describe("herkunftAus", () => {
  it("nimmt die letzte übernommene Herkunft und sonst Hand", () => {
    const fn = herkunftAus([
      vorschlag("a", { art: "teil_hinzu", name: "Fahrrad", menge: 1, groesse: null }, { status: "uebernommen", quelle: "chat" }),
      vorschlag("b", { art: "teil_hinzu", name: "Fahrrad", menge: 2, groesse: null }, { status: "uebernommen", quelle: "bot" }),
      vorschlag("c", { art: "kartons", anzahl: 4 }, { status: "offen", quelle: "eingabe" }),
      vorschlag("d", { art: "posten_weg", hebel: "halteverbot" }, { status: "uebernommen", quelle: "eingabe" }),
    ]);

    expect(fn("teil:fahrrad")).toBe("bot");
    expect(fn("eingabe:umzugskartons")).toBe("hand");
    expect(fn("eingabe:halteverbot.beladen")).toBe("eingabe");
    expect(fn("eingabe:halteverbot.entladen")).toBe("eingabe");
    expect(fn("hebel:halteverbot")).toBe("eingabe");
    expect(fn("fehlt")).toBe("hand");
  });
});

describe("kundenNachricht", () => {
  it("schreibt Sie-Form, bisher und den Link, ohne Gedankenstriche", () => {
    const text = kundenNachricht({
      anrede: "Frau Berg",
      aenderungen: [
        { art: "montage", name: "Sofa\u2014Ecke", abbau: "kunde", aufbau: "kunde" },
        { art: "teil_hinzu", name: "Fahrrad", menge: 1, groesse: null },
        { art: "unklar", text: "unklar \u2013 weg" },
      ],
      hinweise: ["Terminwunsch \u2013 vormittags"],
      preisAltCent: 100000,
      preisNeuCent: 129000,
      link: "https://example.test/angebot/1",
      neuAnnehmen: true,
    });

    expect(text).toContain("Guten Tag Frau Berg,");
    expect(text).toContain("wir haben Ihr Angebot wie besprochen angepasst:");
    expect(text).toContain("Sofa-Ecke: Abbau und Aufbau übernehmen Sie selbst");
    expect(text).toContain("Fahrrad kommt dazu");
    expect(text).toContain("bisher");
    expect(text).toContain("https://example.test/angebot/1");
    expect(text).toContain("bitte nehmen Sie es dort erneut an");
    expect(text).toContain("Terminwunsch, vormittags");
    expect(text).not.toContain("unklar");
    expect(text).not.toContain("\u2013");
    expect(text).not.toContain("\u2014");
    expect(text).not.toMatch(/\b[Dd]u\b/);
    expect(text).not.toMatch(/\b[Dd]ein/);
  });
});

describe("Foto-Vorschläge (Zusatz Inhaber)", () => {
  const foto = (status: "offen" | "uebernommen" | "verworfen", mitnehmen = true): Vorschlag => ({
    id: "foto:f1",
    quelle: "foto",
    aenderung: { art: "teil_hinzu", name: "Fahrrad", menge: 1, groesse: null },
    zitat: "Aus neuen Fotos erkannt",
    status,
    zeit: "2026-11-06T08:00:00.000Z",
    foto: { inventarId: "f1", fotoUrl: null, mitnehmen, dublette: null },
  });

  it("uebernahmePlan: Foto-Teil legt nichts an; „bleibt da“ wird wieder mitgenommen", () => {
    expect(uebernahmePlan([foto("offen")], { inventar: [], montageJetzt: {} }).lead).toEqual([]);
    expect(uebernahmePlan([foto("offen", false)], { inventar: [], montageJetzt: {} }).lead).toEqual([{ art: "wieder", id: "f1", name: "Fahrrad" }]);
  });

  it("herkunftAus: Foto zählt offen und übernommen, verworfen nicht", () => {
    expect(herkunftAus([foto("offen")])("teil:fahrrad")).toBe("foto");
    expect(herkunftAus([foto("uebernommen")])("teil:fahrrad")).toBe("foto");
    expect(herkunftAus([foto("verworfen")])("teil:fahrrad")).toBe("hand");
  });

  it("aenderungsStand: Live-Vorschläge bekommen ihren Status aus dem Log", () => {
    const s = aenderungsStand(
      [{ zeit: "2026-11-06T09:00:00.000Z", payload: { typ: "verworfen", entwurfVersion: 2, ids: ["foto:f1"] } }],
      2,
      [foto("offen")]
    );
    expect(s.vorschlaege.map((v) => [v.id, v.status])).toEqual([["foto:f1", "verworfen"]]);
  });
});

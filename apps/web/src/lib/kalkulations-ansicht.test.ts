import { describe, expect, it } from "vitest";
import { PLAN5_FEHLER_TEXT } from "./angebot-wahl";
import { ansichtAus, type AnsichtRest } from "./kalkulations-ansicht";
import {
  DARIO,
  WEBER_DEAL,
  WEBER_JETZT,
  weberErgebnis,
  weberFotos,
  weberInventar,
  weberUebersteuerungen,
  weberVersion,
} from "./kalkulations-ansicht.fixture";
import type { Uebersteuerung } from "./kalkulation-versionen";

function rest(felder: Partial<AnsichtRest> = {}): AnsichtRest {
  return {
    alle: [
      { version: 1, status: "gesperrt", priceCents: 239000, sentAt: new Date("2026-11-04T10:40:00.000Z") },
      { version: 2, status: "entwurf", priceCents: 248000, sentAt: null },
    ],
    namen: { [DARIO]: "Dario Kottke" },
    deal: { name: "Familie Weber", art: "Umzug", strecke: "Stuttgart nach Esslingen", termin: "2026-11-21", aktenLink: `/app/leads/${WEBER_DEAL}` },
    inventar: weberInventar(),
    fotos: weberFotos(),
    vorlagen: [{ id: "zp_klavier", bezeichnung: "Klavier", minuten: 60, hinweis: "nur mit Gurt" }],
    angebot: null,
    veraltet: false,
    kvDokument: null,
    jetzt: WEBER_JETZT,
    hatPakete: false,
    paketNamen: {},
    renderer: "vps",
    ...felder,
  };
}

const zeile = (a: ReturnType<typeof ansichtAus>, key: string) => {
  const z = a.grundlage.zeilen.find((x) => x.key === key);
  if (!z) throw new Error(`Zeile ${key} fehlt`);
  return z;
};

describe("ansichtAus: Kopf und Versionen", () => {
  it("Kopf mit Unterzeile, Versionsleiste mit gesendetem v1, Angebotsformular-Link", () => {
    const a = ansichtAus(weberVersion(), rest());
    expect(a.kopf).toEqual({
      name: "Familie Weber",
      strecke: "Stuttgart nach Esslingen",
      termin: "Sa 21.11.",
      aktenLink: "/app/leads/deal_weber",
      schritt: "Schritt 3 von 11",
      unterzeile: "Familie Weber, Umzug Stuttgart nach Esslingen, Sa 21.11.",
    });
    expect(a.versionen).toEqual([
      { version: 1, status: "gesperrt", preisCent: 239000, aktiv: false, gesendet: "Mi 04.11. 11:40" },
      { version: 2, status: "entwurf", preisCent: 248000, aktiv: true, gesendet: null },
    ]);
    expect(a.angebotsformularLink).toBe("/objects/deals/deal_weber?tab=quotation");
    expect(a.zeitpostenVorlagen).toEqual([{ id: "zp_klavier", bezeichnung: "Klavier", minuten: 60 }]);
  });

  it("Entwurf, aktuell, ohne Fehler: bearbeitbar und sperrbar; Tarif, Preis-Modus, Renderer", () => {
    const a = ansichtAus(weberVersion(), rest());
    expect(a.version).toEqual({
      nummer: 2, status: "entwurf", bearbeitbar: true, gesperrtText: null, veraltet: false, veraltetGrund: null, fehler: null,
      tarif: "Tarif v1", kvDokument: null, kvErstellbar: false, kvErzeugung: { art: "keins" }, sperrbar: true, sperrGrund: null, preisModus: "fest", renderer: "vps",
    });
    expect(ansichtAus(weberVersion(), rest({ renderer: "crm" })).version.renderer).toBe("crm");
  });
});

describe("ansichtAus: Grundlage", () => {
  const a = ansichtAus(weberVersion(), rest());

  it("Zeilen in der Reihenfolge des Mockups", () => {
    expect(a.grundlage.zeilen.map((z) => z.key)).toEqual(["volumen", "beladen", "entladen", "halteverbot", "kartons", "montage", "team", "termin"]);
    expect(a.grundlage.adressen).toEqual({ beladen: "Rotebühlstr. 112, 70178 Stuttgart", entladen: "Plochinger Str. 8, 73730 Esslingen" });
  });

  it("Volumen: 38 m³ aus Foto und Chat, 31 Teile erkannt (nur mitzunehmende), ein Zahlfeld", () => {
    expect(zeile(a, "volumen")).toEqual({
      key: "volumen", label: "Volumen", wert: "38 m³",
      herkunft: [{ art: "FOTO", text: "FOTO" }, { art: "CHAT", text: "CHAT" }],
      warum: "31 Teile erkannt", bearbeitet: null,
      felder: [{ key: "volumen", label: "Volumen in m³", typ: "zahl", wert: 38 }],
    });
  });

  it("Beladen und Entladen: Straße im Label, Etage und Aufzug, Tragweg mit Herkunft, drei Felder", () => {
    expect(zeile(a, "beladen")).toMatchObject({
      label: "Beladen · Rotebühlstr. 112", wert: "2. OG, kein Aufzug",
      herkunft: [{ art: "KUNDE", text: "KUNDE" }], warum: "Tragweg Standard des Rechners", bearbeitet: null,
    });
    expect(zeile(a, "beladen").felder).toEqual([
      { key: "beladen.etage", label: "Etage", typ: "zahl", wert: 2 },
      { key: "beladen.aufzug", label: "Aufzug", typ: "aufzug", wert: "keiner" },
      { key: "beladen.tragweg", label: "Tragweg in m", typ: "zahl", wert: null },
    ]);
    expect(zeile(a, "entladen")).toMatchObject({ label: "Entladen · Plochinger Str. 8", wert: "EG, kein Aufzug" });
    expect(zeile(a, "entladen").felder.map((f) => f.key)).toEqual(["entladen.etage", "entladen.aufzug", "entladen.tragweg"]);
  });

  it("Halteverbot beidseitig, beim Beladen, beim Entladen, keins; zwei ja/nein-Felder", () => {
    expect(zeile(a, "halteverbot")).toMatchObject({ wert: "beidseitig", warum: null });
    expect(zeile(a, "halteverbot").felder).toEqual([
      { key: "halteverbot.beladen", label: "beim Beladen", typ: "ja_nein", wert: true },
      { key: "halteverbot.entladen", label: "beim Entladen", typ: "ja_nein", wert: true },
    ]);
    const mit = (beladen: boolean, entladen: boolean) => {
      const v = weberVersion();
      v.inputs = v.inputs.map((z) =>
        z.key === "halteverbot.beladen" ? { ...z, wert: beladen } : z.key === "halteverbot.entladen" ? { ...z, wert: entladen } : z
      );
      return zeile(ansichtAus(v, rest()), "halteverbot").wert;
    };
    expect([mit(true, false), mit(false, true), mit(false, false)]).toEqual(["beim Beladen", "beim Entladen", "keins"]);
  });

  it("Kartons: 60 Stück, Ganzzahlfeld", () => {
    expect(zeile(a, "kartons")).toMatchObject({
      wert: "60 Stück", herkunft: [{ art: "KUNDE", text: "KUNDE" }],
      felder: [{ key: "kartons", label: "Kartons", typ: "ganzzahl", wert: 60 }],
    });
  });

  it("Montage: zerlegte Positionen, MANUELL bei Eigentümer im Inventar, Hinweis ohne Katalogzeit, nicht direkt bearbeitbar", () => {
    expect(zeile(a, "montage")).toEqual({
      key: "montage", label: "Montage", wert: "Wandschrank 3-türig und Bett 180x200",
      herkunft: [{ art: "MANUELL", text: "MANUELL" }],
      warum: "1 Position ohne Katalogzeit, bitte Zeitposten anlegen", bearbeitet: null, felder: [],
    });
    // Ohne Eigentümer im Inventar: Regel des Rechners, keine Positionen ohne Katalogzeit gewünscht.
    const ohne = ansichtAus(weberVersion(), rest({ inventar: weberInventar().map((i) => ({ ...i, dismantlingOwner: "none", assemblyOwner: "none" })) }));
    expect(zeile(ohne, "montage")).toMatchObject({ herkunft: [{ art: "REGEL", text: "REGEL" }], warum: null });
  });

  it("Team: 3 Personen nach Regel, Fahrzeug der Empfehlung und Touren", () => {
    expect(zeile(a, "team")).toMatchObject({
      wert: "3 Personen", herkunft: [{ art: "REGEL", text: "REGEL" }], warum: "Sprinter L · 2 Touren",
      felder: [{ key: "team", label: "Team", typ: "ganzzahl", wert: 3 }],
    });
  });

  it("Termin: Sa 21.11. vom Kunden, Datumsfeld", () => {
    expect(zeile(a, "termin")).toMatchObject({
      wert: "Sa 21.11.", herkunft: [{ art: "KUNDE", text: "KUNDE" }],
      felder: [{ key: "termin", label: "Termin", typ: "datum", wert: "2026-11-21" }],
    });
  });

  it("Herkunft MANUELL zeigt den Vornamen groß und „bearbeitet“; Agent zeigt BOT", () => {
    const u = (felder: Partial<Uebersteuerung>): Uebersteuerung => ({
      id: "u_vol", art: "eingabe", key: "volumen", rechnerwert: 38, wert: 42, grund: "Keller vergessen",
      autor: { userId: DARIO, quelle: "mensch" }, zeit: "2026-11-05T14:30:00.000Z", fotoRef: null, ...felder,
    });
    const mensch = ansichtAus(weberVersion({ overrides: [...weberUebersteuerungen(), u({})] }), rest());
    expect(zeile(mensch, "volumen")).toMatchObject({
      wert: "42 m³", herkunft: [{ art: "MANUELL", text: "DARIO" }],
      bearbeitet: { von: "Dario", am: "05.11. 15:30", grund: "Keller vergessen" },
    });
    const bot = ansichtAus(
      weberVersion({ overrides: [...weberUebersteuerungen(), u({ key: "beladen.tragweg", wert: 25, autor: { userId: "usr_key", quelle: "agent" } })] }),
      rest()
    );
    expect(zeile(bot, "beladen")).toMatchObject({
      herkunft: [{ art: "KUNDE", text: "KUNDE" }, { art: "BOT", text: "BOT" }],
      warum: "Tragweg 25 m (Bot)",
      bearbeitet: { von: "Bot", grund: "Keller vergessen" },
    });
  });

  it("Fotos: nur Bilder, neueste zuerst, Treffer aus dem Inventar", () => {
    expect(a.grundlage.fotosGesamt).toBe(3);
    expect(a.grundlage.fotos).toEqual([
      { id: "att_3", url: "/api/v1/inbox/attachments/att_3/content", treffer: [{ name: "Wandschrank 3-türig", volumenCbm: 2.4 }] },
      { id: "att_2", url: "/api/v1/inbox/attachments/att_2/content", treffer: [{ name: "Vitrine Eigenbau", volumenCbm: null }] },
      {
        id: "att_1", url: "/api/v1/inbox/attachments/att_1/content",
        treffer: [{ name: "Sofa 3-Sitzer", volumenCbm: 2 }, { name: "Kommode", volumenCbm: 0.8 }],
      },
    ]);
  });
});

describe("ansichtAus: Selbstkosten", () => {
  const s = ansichtAus(weberVersion(), rest()).selbstkosten;

  it("Gruppen in fester Reihenfolge, Gemeinkosten und Versicherung nicht in den Gruppen", () => {
    expect(s.gruppen.map((g) => [g.key, g.label, g.betragCent])).toEqual([
      ["arbeit", "Arbeit", 44000],
      ["fahrt", "Fahrt", 5940],
      ["fahrzeug.sprinter@sixt-feuerbach", "Sprinter L", 14600],
      ["halteverbot", "Halteverbot", 26000],
      ["material", "Material", 20660],
      ["anfahrt", "Anfahrt", 900],
    ]);
    expect(s.zwischensummeCent).toBe(112100);
    expect(s.gemeinkosten).toEqual({ prozent: 35, betragCent: 39235 });
    expect(s.versicherungCent).toBe(2000);
    expect(s.selbstkostenCent).toBe(153335);
    expect(s.tarifText).toBe("Tarif v1 · Sätze aus Einstellungen");
  });

  it("Arbeit: Formel der Zeile, Unterzeilen aus personalStunden und dem Zeitposten", () => {
    const arbeit = s.gruppen[0];
    expect(arbeit.formel).toBe("22 Personenstunden × 20,00 €/h");
    expect(arbeit.unterzeilen).toEqual([
      { key: "arbeit.laden", label: "Laden, Tragen, Montage", formel: null, wert: "19,5 h", uebersteuert: false },
      { key: "arbeit.uebergabe", label: "Fahrzeugübergabe", formel: null, wert: "0,5 h", uebersteuert: false },
      { key: "arbeit.puffer", label: "Puffer 10 %", formel: null, wert: "+2 h", uebersteuert: false },
      { key: "arbeit.personenstunden", label: "= 26 Personenstunden", formel: null, wert: "8,7 h je Person", uebersteuert: false },
      { key: "zeitposten.wandschrank", label: "Wandschrank, Demontage + Aufbau · Dario", formel: null, wert: "+90 min", uebersteuert: true },
    ]);
  });

  it("Fahrzeug: Summe der Zeilen, Formel der Mietzeile, übrige Zeilen darunter; Material Zeile für Zeile", () => {
    const fz = s.gruppen[2];
    expect(fz.formel).toBe("1 Tag × 136,50 €");
    expect(fz.unterzeilen).toEqual([
      { key: "fahrzeug.sprinter@sixt-feuerbach.kraftstoff", label: "Kraftstoff (48 km × 12 l/100 km)", formel: "5,76 l × 1,65 €", wert: "9,50 €", uebersteuert: false },
    ]);
    expect(s.gruppen[3].formel).toBe("2 Stück × 130,00 €");
    expect(s.gruppen[4].unterzeilen.map((u) => [u.label, u.wert])).toEqual([
      ["Folie", "30 €"], ["Decken und Gurte", "26,60 €"], ["Umzugskartons", "150 €"],
    ]);
  });

  it("übersteuerte Zeile ist markiert; Formel fällt ohne `formel` auf Menge × Satz zurück; unbekannte Schlüssel unter Weitere Kosten", () => {
    const e = weberErgebnis();
    e.kosten!.posten = e.kosten!.posten!.map((p) =>
      p.key === "halteverbot" ? { ...p, betrag: 0, quelle: "uebersteuert", formel: undefined } : p
    );
    e.kosten!.posten!.push({ key: "entsorgung", bezeichnung: "Entsorgung", menge: 2, einheit: "m³", satz: 40, betrag: 80 });
    e.kosten!.posten!.push({ key: "sonder.klavier", bezeichnung: "Klaviergurt", menge: null, einheit: null, satz: null, betrag: 15 });
    const g = ansichtAus(weberVersion({ rechnerResult: e }), rest()).selbstkosten.gruppen;
    const hv = g.find((x) => x.key === "halteverbot")!;
    expect(hv).toMatchObject({ uebersteuert: true, betragCent: 0, formel: "2 Stück × 130 €" });
    expect(g.map((x) => x.key).slice(-2)).toEqual(["entsorgung", "weitere"]);
    expect(g.at(-1)).toMatchObject({ label: "Weitere Kosten", betragCent: 1500, unterzeilen: [{ label: "Klaviergurt", wert: "15 €" }] });
    // Übersteuerbar ist nur ein echter Schlüssel des Rechners; Summengruppen nur über ihre Zeilen.
    expect(g.find((x) => x.key === "arbeit")?.postenKey).toBe("personal.arbeit");
    expect(hv.postenKey).toBe("halteverbot");
    expect(g.find((x) => x.key.startsWith("fahrzeug."))?.postenKey).toMatch(/^fahrzeug\.[^.]+\.(miete|tagespauschale)$/);
    expect(g.find((x) => x.key === "material")?.postenKey).toBeNull();
    expect(g.at(-1)?.postenKey).toBeNull();
  });

  it("Hauptzeile je Gruppe: Betrag und Bezeichnung der Zeile selbst, nicht die Gruppensumme; Summengruppen ohne (I3)", () => {
    const posten = weberErgebnis().kosten!.posten!;
    const miete = posten.find((p) => p.key === "fahrzeug.sprinter@sixt-feuerbach.miete")!;
    const fz = s.gruppen.find((g) => g.key === "fahrzeug.sprinter@sixt-feuerbach")!;
    expect(fz.postenBetragCent).toBe(Math.round(miete.betrag * 100));
    expect(fz.postenLabel).toBe(miete.bezeichnung);
    expect(fz.postenBetragCent).not.toBe(fz.betragCent);
    const arbeit = posten.find((p) => p.key === "personal.arbeit")!;
    expect(s.gruppen[0]).toMatchObject({ postenBetragCent: Math.round(arbeit.betrag * 100), postenLabel: arbeit.bezeichnung });
    expect(s.gruppen.find((g) => g.key === "material")).toMatchObject({ postenBetragCent: null, postenLabel: null });
  });
});

describe("ansichtAus: Marge und Preis", () => {
  it("Marge mit Vorschlag, Gründen und Wahl von Dario", () => {
    const a = ansichtAus(weberVersion(), rest());
    expect(a.marge).toEqual({
      vorschlagProzent: 37,
      gewaehltProzent: 38,
      gewaehltVon: "Dario",
      gruende: [
        { text: "Basis Kottke", punkte: 40 },
        { text: "Quelle Kleinanzeigen", punkte: -3 },
        { text: "Freitag, keine Eile, kein Monatsende", punkte: 0 },
      ],
      min: 30,
      max: 60,
      rundungEur: 10,
      selbstkostenEur: 1533.35,
    });
  });

  it("Preisformel 1.533 € ÷ (1 − 0,38), roh 2.473 €, gerundet 2.480 €, Gewinn und Listenpreis", () => {
    expect(ansichtAus(weberVersion(), rest()).preis).toEqual({
      formel: "Preis = 1.533 € ÷ (1 − 0,38)",
      preisRohText: "2.473 €",
      gerundetCent: 248000,
      gewinnCent: 94665,
      listenpreisCent: 265000,
      spanne: null,
    });
  });

  it("ohne Marge-Übersteuerung gilt die wirksame Marge des Rechners, ohne Namen", () => {
    const ohne = weberUebersteuerungen().filter((u) => u.art !== "marge");
    const e = weberErgebnis();
    e.preis!.margeWirksamProzent = 37;
    const a = ansichtAus(weberVersion({ overrides: ohne, rechnerResult: e }), rest());
    expect(a.marge).toMatchObject({ vorschlagProzent: 37, gewaehltProzent: 37, gewaehltVon: null });
    expect(a.preis.formel).toBe("Preis = 1.533 € ÷ (1 − 0,37)");
  });
});

describe("ansichtAus: So steht es im KV", () => {
  it("Entwurf: Vorschau aus der Übernahme, Herkunft je Posten aus den Hebeln, Summe = Festpreis", () => {
    const a = ansichtAus(weberVersion(), rest());
    expect(a.kvFehler).toBeNull();
    expect(a.kv).toMatchObject({ vorschau: true, obergrenze: false, summeCent: 248000 });
    expect(a.kv!.posten.map((p) => [p.herkunft, p.betragCent])).toEqual([
      ["Rest nach den Hebeln", 205000],
      ["Montage", 6000],
      ["Halteverbot", 30000],
      ["Einpacken", 7000],
    ]);
    expect(a.kv!.posten[0].text).toMatch(/^Umzugsteam \(3 Personen\) & Transporter/);
  });

  it("nur Spanne: Vorschau mit der Obergrenze, Preis zeigt die Spanne", () => {
    const e = weberErgebnis();
    e.schaetzung = { festpreisVon: 2100, festpreisBis: 2600, annahmen: [], selbstkostenVon: 1300, selbstkostenBis: 1600, margeProzent: 38 };
    const a = ansichtAus(weberVersion({ rechnerResult: e }), rest());
    expect(a.kv).toMatchObject({ vorschau: true, obergrenze: true, summeCent: 260000 });
    expect(a.preis.spanne).toEqual({ vonCent: 210000, bisCent: 260000 });
  });

  it("Übernahme lehnt ab: kein KV, Text als kvFehler, nicht sperrbar", () => {
    const e = weberErgebnis();
    e.preis = { festpreis: null, nichtKalkulierbarGrund: "Keine Adresse" };
    const a = ansichtAus(weberVersion({ rechnerResult: e }), rest());
    expect(a.kv).toBeNull();
    expect(a.kvFehler).toBe("Kein Preis kalkulierbar: Keine Adresse");
    expect(a.version).toMatchObject({ sperrbar: false, sperrGrund: "Kein Preis kalkulierbar: Keine Adresse" });
  });
});

describe("ansichtAus: gesperrte Version (Review Focus 2)", () => {
  const kvItems = [
    { description: "Umzugsteam (3 Personen) & Transporter, inkl. Anfahrt, aller Kilometer, Möbelschutz und Tragewege", quantity: 1, unitRate: 1960 },
    { description: "Halteverbotszone inkl. Beantragung und Schildern (Rotebühlstr. 112 und Plochinger Str. 8)", quantity: 2, unitRate: 150 },
    { description: "Einpackservice (60 Kartons)", quantity: 1, unitRate: 70 },
    { description: "Demontage & Montage (Wandschrank 3-türig, Bett 180x200 und Vitrine Eigenbau)", quantity: 1, unitRate: 60 },
  ];
  const gesperrt = weberVersion({
    version: 1, status: "gesperrt", priceCents: 239000, kvItems,
    lockedAt: new Date("2026-11-04T10:30:00.000Z"), lockedBy: DARIO,
    sentAt: new Date("2026-11-04T10:40:00.000Z"), sentVia: "whatsapp",
  });
  const a = ansichtAus(gesperrt, rest({ veraltet: true, kvDokument: { id: "doc_1", fileName: "KV-Weber.pdf" } }));

  it("nicht bearbeitbar, nicht sperrbar, nie veraltet, Text mit Sendezeit, KV-Dokument", () => {
    expect(a.version).toMatchObject({
      nummer: 1, status: "gesperrt", bearbeitbar: false, sperrbar: false, veraltet: false,
      gesperrtText: "v1 gesperrt · gesendet Mi 04.11. 11:40", kvDokument: { id: "doc_1", fileName: "KV-Weber.pdf" },
    });
    expect(a.version.sperrGrund).toBe("v1 ist gesperrt. Änderungen landen in einem neuen Entwurf.");
    expect(a.versionen.find((v) => v.aktiv)?.version).toBe(1);
  });

  it("KV aus den gespeicherten Posten (keine Vorschau), Herkunft je Posten", () => {
    expect(a.kv).toMatchObject({ vorschau: false, obergrenze: false, summeCent: 239000 });
    expect(a.kv!.posten.map((p) => [p.herkunft, p.betragCent])).toEqual([
      ["Rest nach den Hebeln", 196000],
      ["Halteverbot", 30000],
      ["Einpacken", 7000],
      ["Montage", 6000],
    ]);
  });

  it("gesperrt, nicht gesendet", () => {
    const b = ansichtAus({ ...gesperrt, sentAt: null }, rest());
    expect(b.version.gesperrtText).toBe("v1 gesperrt · noch nicht gesendet");
  });
});

describe("ansichtAus: Sperrbarkeit", () => {
  it.each([
    ["veraltet", rest({ veraltet: true }), {}, "Die Kalkulation ist nicht mehr aktuell. Bitte zuerst neu rechnen."],
    ["Fehler", rest(), { error: "Rechner nicht erreichbar." }, "Der Rechner hat einen Fehler gemeldet. Bitte neu rechnen."],
    ["Pakete", rest({ hatPakete: true }), {}, "Sperren mit Paketpreisen kommt später. Bis dahin den Preis über die Paketpreise pflegen."],
    ["Stunden-Version", rest(), { pricingMode: "stunden" as const }, "Sperren mit Stunden-KV kommt später. Bis dahin das Angebot über das Angebotsformular pflegen."],
    ["Stunden-KV im Angebot", rest({ angebot: { notes: null, isVariable: true, validUntil: null } }), {}, "Sperren mit Stunden-KV kommt später. Bis dahin das Angebot über das Angebotsformular pflegen."],
  ])("%s → nicht sperrbar mit Grund", (_name, r, felder, grund) => {
    const a = ansichtAus(weberVersion(felder), r);
    expect(a.version.sperrbar).toBe(false);
    expect(a.version.sperrGrund).toBe(grund);
  });

  it("veraltet und Fehler stehen in der Version; Stunden setzt preisModus", () => {
    const a = ansichtAus(weberVersion({ error: "Rechner nicht erreichbar." }), rest({ veraltet: true, angebot: { notes: null, isVariable: true, validUntil: null } }));
    expect(a.version).toMatchObject({ veraltet: true, fehler: "Rechner nicht erreichbar.", preisModus: "stunden" });
  });

  it("Pakete: Preise je Paket mit Namen, nicht kalkulierbare mit Hinweis", () => {
    const a = ansichtAus(
      weberVersion({ packagePrices: [{ slug: "basis", festpreis: 1990, selbstkosten: 1300 }, { slug: "komfort", festpreis: null, selbstkosten: 1700 }] }),
      rest({ hatPakete: true, paketNamen: { basis: "Basis" } })
    );
    expect(a.pakete).toEqual([
      { slug: "basis", name: "Basis", preisCent: 199000, hinweis: null },
      { slug: "komfort", name: "komfort", preisCent: null, hinweis: "Nicht kalkulierbar." },
    ]);
  });

  it("veraltetGrund: eingabe bei geändertem Lead, rechner ohne Montage-Echo mit eigenem Sperrgrund (M9)", () => {
    expect(ansichtAus(weberVersion(), rest()).version.veraltetGrund).toBeNull();
    const eingabe = ansichtAus(weberVersion(), rest({ veraltet: true })).version;
    expect(eingabe.veraltetGrund).toBe("eingabe");
    expect(eingabe.sperrGrund).toBe("Die Kalkulation ist nicht mehr aktuell. Bitte zuerst neu rechnen.");
    const e = weberErgebnis();
    delete e.montageJePosition;
    const rechner = ansichtAus(weberVersion({ rechnerResult: e }), rest({ veraltet: true })).version;
    expect(rechner.veraltetGrund).toBe("rechner");
    expect(rechner.sperrbar).toBe(false);
    expect(rechner.sperrGrund).toBe("Der Rechner ist noch nicht auf dem neuen Stand. Sperren geht nach dem Rechner-Update.");
    expect(ansichtAus(weberVersion({ status: "gesperrt", rechnerResult: e }), rest({ veraltet: true })).version.veraltetGrund).toBeNull();
  });

  it("kvErstellbar nur für die neueste gesperrte Version ohne KV-Dokument (M2)", () => {
    const alle = [
      { version: 1, status: "gesperrt" as const, priceCents: 239000, sentAt: null },
      { version: 2, status: "gesperrt" as const, priceCents: 248000, sentAt: null },
      { version: 3, status: "entwurf" as const, priceCents: null, sentAt: null },
    ];
    expect(ansichtAus(weberVersion({ status: "gesperrt", version: 2 }), rest({ alle })).version.kvErstellbar).toBe(true);
    expect(ansichtAus(weberVersion({ status: "gesperrt", version: 1 }), rest({ alle })).version.kvErstellbar).toBe(false);
    expect(
      ansichtAus(weberVersion({ status: "gesperrt", version: 2 }), rest({ alle, kvDokument: { id: "d1", fileName: "KV.pdf" } })).version.kvErstellbar
    ).toBe(false);
    expect(ansichtAus(weberVersion({ version: 3 }), rest({ alle })).version.kvErstellbar).toBe(false);
  });
});

describe("ansichtAus: Anpassungen", () => {
  it("nur wirksame, aufgehobene fehlen, Marge höchstens einmal, Text {Bezeichnung}: {Wert}", () => {
    const zweiteMarge: Uebersteuerung = { ...weberUebersteuerungen()[3], id: "u_marge2", wert: 40, zeit: "2026-11-05T08:00:00.000Z", grund: "doch mehr" };
    const a = ansichtAus(weberVersion({ overrides: [...weberUebersteuerungen(), zweiteMarge] }), rest());
    // Der Wert selbst fährt mit (Vorbelegung beim Ändern, M6).
    expect(a.anpassungen.map((x) => x.wert)).toEqual([weberUebersteuerungen()[0].wert, 40]);
    expect(a.anpassungen).toMatchObject([
      {
        id: "u_wandschrank", art: "zeitposten", key: "wandschrank", text: "Wandschrank, Demontage + Aufbau: +1,5 h Arbeit",
        von: "Dario", am: "04.11. 10:48", grund: "3-türig, auf Foto 3, braucht Demontage und Aufbau, Rechner hatte 0",
      },
      { id: "u_marge2", art: "marge", key: "marge", text: "Marge: 40 %", von: "Dario", am: "05.11. 09:00", grund: "doch mehr" },
    ]);
  });

  it("Texte der übrigen Arten", () => {
    const u = (art: Uebersteuerung["art"], key: string, wert: Uebersteuerung["wert"]): Uebersteuerung => ({
      id: `u_${key}`, art, key, rechnerwert: null, wert, grund: "g", autor: { userId: null, quelle: "agent" }, zeit: "2026-11-05T08:00:00.000Z", fotoRef: null,
    });
    const a = ansichtAus(
      weberVersion({
        overrides: [
          u("eingabe", "beladen.aufzug", "klein"),
          u("eingabe", "halteverbot.entladen", false),
          u("zeile", "halteverbot", 130),
          u("satz", "fahrt", 18),
          u("material_frei", "folie", { bezeichnung: "Extra Folie", betrag: 25 }),
        ],
      }),
      rest()
    );
    expect(a.anpassungen.map((x) => [x.text, x.von])).toEqual([
      ["Aufzug beim Beladen: kleiner Aufzug", "Bot"],
      ["Halteverbot beim Entladen: nein", "Bot"],
      ["Halteverbotszone: 130 €", "Bot"],
      ["Stundensatz Fahrt: 18 €/h", "Bot"],
      ["Extra Folie: 25 €", "Bot"],
    ]);
  });

  it("Zeilen-Anpassung, die nach dem Neurechnen keine Zeile mehr trifft, ist als wirkungslos markiert", () => {
    const v = weberVersion({
      overrides: [
        { id: "u1", art: "zeile", key: "fahrzeug.sprinter_l@alte_station.kraftstoff", wert: 20, grund: "Tankquittung", autor: { typ: "user", id: "u_dario" }, zeit: "2026-11-05T10:00:00.000Z" },
      ],
    } as never);
    const a = ansichtAus(v, rest()).anpassungen;
    expect(a).toHaveLength(1);
    expect(a[0].text).toContain("(wirkt nicht, die Zeile gibt es nach dem Neurechnen nicht mehr)");
  });
});

const MIETE_HIER = "fahrzeug.sprinter@sixt-feuerbach.miete";
const MIETE_ALT = "fahrzeug.sprinter@alte-station.miete";

function zeilenAnpassung(key: string, wert: number | null, id = "u_fz"): Uebersteuerung {
  return {
    id, art: "zeile", key, rechnerwert: 136.5, wert, grund: "Sonderpreis",
    autor: { userId: DARIO, quelle: "mensch" }, zeit: "2026-11-05T10:00:00.000Z", fotoRef: null,
  };
}

describe("ansichtAus: verwaiste Zeilen-Anpassung", () => {
  it("füllt verwaist und sperrt den Entwurf, wenn die Kostenzeile fehlt", () => {
    const a = ansichtAus(weberVersion({ overrides: [...weberUebersteuerungen(), zeilenAnpassung(MIETE_ALT, 100)] }), rest());
    expect(a.verwaist).toMatchObject([{ id: "u_fz", key: MIETE_ALT, kandidaten: [MIETE_HIER] }]);
    expect(a.version.sperrbar).toBe(false);
    expect(a.version.sperrGrund).toBe(PLAN5_FEHLER_TEXT.UEBERSTEUERUNG_VERWAIST);
  });

  it("ohne verwaiste Zeile bleibt verwaist leer und der Entwurf sperrbar", () => {
    const a = ansichtAus(weberVersion({ overrides: [zeilenAnpassung(MIETE_HIER, 100)] }), rest());
    expect(a.verwaist).toEqual([]);
    expect(a.version).toMatchObject({ sperrbar: true, sperrGrund: null });
  });

  it("früherer Grund bleibt, verwaist ist trotzdem gefüllt", () => {
    const a = ansichtAus(
      weberVersion({ overrides: [zeilenAnpassung(MIETE_ALT, 100)] }),
      rest({ veraltet: true })
    );
    expect(a.verwaist).toMatchObject([{ id: "u_fz", key: MIETE_ALT, kandidaten: [MIETE_HIER] }]);
    expect(a.version.sperrGrund).toBe("Die Kalkulation ist nicht mehr aktuell. Bitte zuerst neu rechnen.");
  });

  it("gesperrte Version: verwaist gefüllt, Sperrgrund bleibt der gesperrte Text", () => {
    const a = ansichtAus(weberVersion({ status: "gesperrt", overrides: [zeilenAnpassung(MIETE_ALT, 100)] }), rest());
    expect(a.verwaist).toHaveLength(1);
    expect(a.version.sperrGrund).toBe("v2 ist gesperrt. Änderungen landen in einem neuen Entwurf.");
  });
});

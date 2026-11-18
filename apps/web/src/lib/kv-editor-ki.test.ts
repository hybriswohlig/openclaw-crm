import { describe, expect, it } from "vitest";
import {
  KV_ABSCHNITT_TITEL,
  KV_FELDER_VPS,
  KV_KI_LEER_TEXT,
  KV_KI_MAX_AENDERUNGEN,
  type KvBasis,
  type KvFeld,
  type KvWert,
  type VpsPaketTeile,
} from "./kv-editor";
import { crmBasis, vpsBasis } from "./kv-editor-anwenden";
import rohJson from "./__fixtures__/kv-paket-umzug.json";
import { katalogZeilen, kiAntwortNormalisieren, ohneGedankenstrich } from "./kv-editor-ki";

const roh = rohJson as {
  details: VpsPaketTeile["details"];
  auftrag: VpsPaketTeile["auftrag"];
  inventarIds: (string | null)[];
  bildIds: string[];
};

const ALLE_MUSTER = new Set(KV_FELDER_VPS.map((d) => d.muster));

const MODEL = {
  intro: ["Sehr geehrte Frau A,", "wir danken Ihnen für die Anfrage.", "Der Umzug ist am Dienstag."],
  closing: ["Mit freundlichen Grüßen", "Ihr Team"],
  remarks: "Bitte die Klingel nutzen.",
  summary: "Umzug der Wohnung",
};
const EINLEITUNG = "wir danken Ihnen für die Anfrage.\n\nDer Umzug ist am Dienstag.";

function vps(): KvBasis {
  return vpsBasis(
    {
      details: structuredClone(roh.details),
      auftrag: structuredClone(roh.auftrag),
      inventarIds: structuredClone(roh.inventarIds),
      bildIds: structuredClone(roh.bildIds),
    },
    ALLE_MUSTER
  );
}

function crm(): KvBasis {
  return crmBasis(MODEL, {});
}

/** Wert, der für das Feld gültig ist und nicht dem Basiswert entspricht. */
function andererWert(feld: KvFeld): KvWert {
  if (feld.art === "zeigen") return false;
  if (feld.art === "zustaendig") return feld.basis === "customer" ? "none" : "customer";
  return feld.basis === "Hinweis extra" ? "Hinweis zwei" : "Hinweis extra";
}

describe("ohneGedankenstrich", () => {
  it("setzt Gedankenstriche mit Leerraum zu Komma, Aufzählung und Ziffernspanne bleiben Sonderfälle", () => {
    expect(ohneGedankenstrich("Wir kommen \u2014 morgen")).toBe("Wir kommen, morgen");
    expect(ohneGedankenstrich("Wir kommen \u2013 morgen")).toBe("Wir kommen, morgen");
    expect(ohneGedankenstrich("Wir kommen  \u2014  morgen")).toBe("Wir kommen, morgen");
    expect(ohneGedankenstrich("\u2013 Punkt")).toBe("- Punkt");
    expect(ohneGedankenstrich("\u2014 Punkt")).toBe("- Punkt");
    expect(ohneGedankenstrich("Liste\n\u2013 Punkt")).toBe("Liste\n- Punkt");
    expect(ohneGedankenstrich("2\u20133")).toBe("2-3");
    expect(ohneGedankenstrich("2\u20143")).toBe("2-3");
    expect(ohneGedankenstrich("2\u20133\u20134")).toBe("2-3-4");
    expect(ohneGedankenstrich("2 \u2013 3")).toBe("2, 3");
    expect(ohneGedankenstrich("T\u00fcr\u2014Rahmen")).toBe("T\u00fcr, Rahmen");
    expect(ohneGedankenstrich("3-t\u00fcrig")).toBe("3-t\u00fcrig");
    expect(ohneGedankenstrich("Euro-Paletten")).toBe("Euro-Paletten");
    expect(ohneGedankenstrich("Kleiderschrank 3-t\u00fcrig \u2014 bleibt")).toBe("Kleiderschrank 3-t\u00fcrig, bleibt");
    expect(ohneGedankenstrich("Zeile 1\nZeile 2")).toBe("Zeile 1\nZeile 2");
  });

  it("räumt Leerzeichen vor Kommas, doppelte Kommas und ein Komma am Textende auf", () => {
    expect(ohneGedankenstrich("foo , bar")).toBe("foo, bar");
    expect(ohneGedankenstrich("a,,b")).toBe("a,b");
    expect(ohneGedankenstrich("fertig,")).toBe("fertig");
    expect(ohneGedankenstrich("Ende \u2014")).toBe("Ende, ");
    expect(ohneGedankenstrich("a,\nb,")).toBe("a,\nb");
  });
});

describe("katalogZeilen", () => {
  it("beginnt mit der Kopfzeile und liest den CRM-Katalog", () => {
    const basis = crm();
    const zeilen = katalogZeilen(basis, {});
    expect(zeilen[0]).toBe("schluessel | Abschnitt | Gruppe | Label | Art | Werte | max | aktuell");
    expect(zeilen).toHaveLength(basis.felder.length + 1);
    expect(zeilen[1]).toBe(
      `anschreiben:einleitung:text | ${KV_ABSCHNITT_TITEL.anschreiben} |  | Einleitung | langtext | Text | 2000 | ${JSON.stringify(EINLEITUNG)}`
    );
    expect(zeilen[2]).toBe(
      `uebersicht:zusammenfassung:text | ${KV_ABSCHNITT_TITEL.uebersicht} |  | Leistung | langtext | Text | 1000 | ${JSON.stringify("Umzug der Wohnung")}`
    );
    expect(zeilen[4]).toContain("| Text | 2000 |");
  });

  it("nimmt den aktuellen Wert vor der Basis und ersetzt Senkrechtstriche in der Gruppe", () => {
    const basis = crm();
    const zeilen = katalogZeilen(basis, { "anschreiben:einleitung:text": "Neu" });
    expect(zeilen[1]?.endsWith(`| ${JSON.stringify("Neu")}`)).toBe(true);
    expect(zeilen[1]).not.toContain(EINLEITUNG);

    const v = vps();
    const felder = v.felder.map((f) =>
      f.schluessel === "leistungen:transport:notiz" ? { ...f, gruppe: "Trans|port\nNord" } : f
    );
    const transport = katalogZeilen({ ...v, felder }, {}).find((z) => z.startsWith("leistungen:transport:notiz |"));
    expect(transport).toBe(
      `leistungen:transport:notiz | ${KV_ABSCHNITT_TITEL.leistungen} | Trans/port Nord | Notiz | langtext | Text | 500 | ${JSON.stringify("Transport mit einem Koffer-Lkw")}`
    );
  });

  it("nennt bei Zuständigkeit mit und ohne Firma und bei zeigen die erlaubten Werte", () => {
    const zeilen = katalogZeilen(vps(), { "bilder:bild-03:zeigen": false });
    const mitFirma = zeilen.find((z) => z.startsWith("leistungen:transport:zustaendig |"));
    const ohneFirma = zeilen.find((z) => z.startsWith("leistungen:packing:zustaendig |"));
    const foto = zeilen.find((z) => z.startsWith("bilder:bild-03:zeigen |"));
    expect(mitFirma).toBe(
      `leistungen:transport:zustaendig | ${KV_ABSCHNITT_TITEL.leistungen} | Transport | Zuständig | zustaendig | company, customer, none |  | ${JSON.stringify("company")}`
    );
    expect(ohneFirma).toBe(
      `leistungen:packing:zustaendig | ${KV_ABSCHNITT_TITEL.leistungen} | Einpacken | Zuständig | zustaendig | customer, none |  | ${JSON.stringify("customer")}`
    );
    expect(foto).toBe(
      `bilder:bild-03:zeigen | ${KV_ABSCHNITT_TITEL.bilder} | Foto 3 | Im KV zeigen | zeigen | true, false |  | false`
    );
  });
});

describe("kiAntwortNormalisieren", () => {
  it("liest kaputten Text und abgeschnittenes JSON als leere Antwort", () => {
    const basis = vps();
    const text = kiAntwortNormalisieren("Das ist kein JSON \u2014 nur Text", basis, {});
    expect(text).toEqual({
      antwort: "Das ist kein JSON, nur Text",
      vorschlaege: [],
      abgelehnt: [{ schluessel: null, grund: "LEER" }],
    });

    const abgeschnitten = kiAntwortNormalisieren(
      '  {"antwort":"Hallo","aenderungen":[{"schluessel":"uebersicht:termin:zeit","wert":"neun"',
      basis,
      {}
    );
    expect(abgeschnitten).toEqual({
      antwort: KV_KI_LEER_TEXT,
      vorschlaege: [],
      abgelehnt: [{ schluessel: null, grund: "LEER" }],
    });
  });

  it("liest einen JSON-Zaun, Text um das JSON und ein Objekt", () => {
    const basis = vps();
    const aenderung = { schluessel: "uebersicht:termin:zeit", wert: "gegen neun" };
    const vorschlag = {
      schluessel: "uebersicht:termin:zeit",
      wert: "gegen neun",
      vorher: "Beginn gegen acht Uhr",
    };
    const koerper = { antwort: "Passt \u2014 danke.", aenderungen: [aenderung] };
    const erwartet = {
      antwort: "Passt, danke.",
      vorschlaege: [vorschlag],
      abgelehnt: [],
    };

    const zaun = "```json\n" + JSON.stringify(koerper) + "\n```";
    expect(kiAntwortNormalisieren(zaun, basis, {})).toEqual(erwartet);
    expect(kiAntwortNormalisieren(`Vorher\n${JSON.stringify(koerper)}\nNachher`, basis, {})).toEqual(erwartet);
    expect(kiAntwortNormalisieren(koerper, basis, {})).toEqual(erwartet);
  });

  it("behält höchstens die ersten 30 von 50 gültigen Einträgen, in Katalogreihenfolge", () => {
    const basis = vps();
    expect(basis.felder.length).toBeGreaterThanOrEqual(50);
    const felder = basis.felder.slice(0, 50);
    const aenderungen = [...felder].reverse().map((f) => ({ schluessel: f.schluessel, wert: andererWert(f) }));
    const aus = kiAntwortNormalisieren({ antwort: "Viele.", aenderungen }, basis, {});
    const behalten = felder.slice(felder.length - KV_KI_MAX_AENDERUNGEN);
    expect(aus.vorschlaege.map((v) => v.schluessel)).toEqual(behalten.map((f) => f.schluessel));
    expect(aus.vorschlaege).toHaveLength(KV_KI_MAX_AENDERUNGEN);
    expect(aus.vorschlaege[0]).toEqual({
      schluessel: behalten[0].schluessel,
      wert: andererWert(behalten[0]),
      vorher: behalten[0].basis,
    });
    expect(aus.vorschlaege.some((v) => v.schluessel === felder[0].schluessel)).toBe(false);
    expect(aus.abgelehnt).toEqual([]);
    expect(aus.antwort).toBe("Viele.");
  });

  it("lässt Einträge hinter der Grenze still weg, auch wenn sie ungültig wären", () => {
    const basis = vps();
    const aenderungen = [
      { schluessel: "uebersicht:termin:zeit", wert: "gegen neun" },
      ...Array.from({ length: KV_KI_MAX_AENDERUNGEN - 1 }, (_, i) => ({
        schluessel: `gibt:es:nicht:${i}`,
        wert: "x",
      })),
      { schluessel: "preise:gesamt:betrag", wert: "9" },
    ];
    const aus = kiAntwortNormalisieren({ antwort: "Grenze.", aenderungen }, basis, {});
    expect(aus.vorschlaege).toEqual([
      { schluessel: "uebersicht:termin:zeit", wert: "gegen neun", vorher: "Beginn gegen acht Uhr" },
    ]);
    expect(aus.abgelehnt).toHaveLength(KV_KI_MAX_AENDERUNGEN - 1);
    expect(aus.abgelehnt.every((a) => a.schluessel?.startsWith("gibt:es:nicht:") && a.grund === "UNBEKANNT")).toBe(
      true
    );
    expect(aus.abgelehnt.some((a) => a.schluessel === "preise:gesamt:betrag")).toBe(false);
    expect(aus.antwort).toBe("Grenze.");
  });

  it("lehnt unbekannte Schlüssel, das Preisfeld, Typ, Länge, Preis und Firma ab", () => {
    const basis = vps();
    const aus = kiAntwortNormalisieren(
      {
        antwort: "Versuch",
        aenderungen: [
          { schluessel: "gibt:es:nicht", wert: "x" },
          { schluessel: "preise:gesamt:betrag", wert: "100" },
          { schluessel: "uebersicht:auszug:details", wert: true },
          { schluessel: "uebersicht:termin:zeit", wert: "x".repeat(121) },
          { schluessel: "uebersicht:einzug:details", wert: "20 % Rabatt" },
          { schluessel: "leistungen:packing:zustaendig", wert: "company" },
          "kein objekt",
          { schluessel: 5, wert: "x" },
        ],
      },
      basis,
      {}
    );
    expect(aus.vorschlaege).toEqual([]);
    expect(aus.abgelehnt).toEqual([
      { schluessel: "gibt:es:nicht", grund: "UNBEKANNT" },
      { schluessel: "preise:gesamt:betrag", grund: "UNBEKANNT" },
      { schluessel: "uebersicht:auszug:details", grund: "TYP" },
      { schluessel: "uebersicht:termin:zeit", grund: "ZU_LANG" },
      { schluessel: "uebersicht:einzug:details", grund: "PREIS" },
      { schluessel: "leistungen:packing:zustaendig", grund: "FIRMA_GESPERRT" },
      { schluessel: null, grund: "UNBEKANNT" },
      { schluessel: null, grund: "UNBEKANNT" },
      { schluessel: null, grund: "LEER" },
    ]);
    expect(aus.antwort).toBe(`Versuch\n\n${KV_KI_LEER_TEXT}`);
  });

  it("hängt den Leertext nicht doppelt an und lässt eine leere Änderungliste in Ruhe", () => {
    const basis = vps();
    const schon = kiAntwortNormalisieren(
      {
        antwort: KV_KI_LEER_TEXT,
        aenderungen: [{ schluessel: "preise:gesamt:betrag", wert: "1" }],
      },
      basis,
      {}
    );
    expect(schon.antwort).toBe(KV_KI_LEER_TEXT);
    expect(schon.abgelehnt).toEqual([
      { schluessel: "preise:gesamt:betrag", grund: "UNBEKANNT" },
      { schluessel: null, grund: "LEER" },
    ]);

    const enthalten = kiAntwortNormalisieren(
      {
        antwort: `Hinweis: ${KV_KI_LEER_TEXT}`,
        aenderungen: [{ schluessel: "gibt:es:nicht", wert: "x" }],
      },
      basis,
      {}
    );
    expect(enthalten.antwort).toBe(`Hinweis: ${KV_KI_LEER_TEXT}`);
    expect(enthalten.abgelehnt).toEqual([
      { schluessel: "gibt:es:nicht", grund: "UNBEKANNT" },
      { schluessel: null, grund: "LEER" },
    ]);

    const leer = kiAntwortNormalisieren({ antwort: "Nur die Antwort.", aenderungen: [] }, basis, {});
    expect(leer).toEqual({ antwort: "Nur die Antwort.", vorschlaege: [], abgelehnt: [] });

    const keinArray = kiAntwortNormalisieren(
      { antwort: "Nur die Antwort.", aenderungen: "keine" },
      basis,
      {}
    );
    expect(keinArray).toEqual({ antwort: "Nur die Antwort.", vorschlaege: [], abgelehnt: [] });
  });

  it("lässt unveränderte Werte weg und zählt Gleichheit nicht als leere Lieferung", () => {
    const basis = vps();
    const gleich = kiAntwortNormalisieren(
      {
        antwort: "Unverändert.",
        aenderungen: [{ schluessel: "uebersicht:termin:zeit", wert: "Beginn gegen acht Uhr" }],
      },
      basis,
      {}
    );
    expect(gleich).toEqual({ antwort: "Unverändert.", vorschlaege: [], abgelehnt: [] });

    const gemischt = kiAntwortNormalisieren(
      {
        antwort: "Teils.",
        aenderungen: [
          { schluessel: "uebersicht:termin:zeit", wert: "Beginn gegen acht Uhr" },
          { schluessel: "gibt:es:nicht", wert: "x" },
        ],
      },
      basis,
      {}
    );
    expect(gemischt.vorschlaege).toEqual([]);
    expect(gemischt.abgelehnt).toEqual([{ schluessel: "gibt:es:nicht", grund: "UNBEKANNT" }]);
    expect(gemischt.antwort).toBe("Teils.");
  });

  it("nimmt den letzten Wert, den aktuellen Stand als Vorher und die Katalogreihenfolge", () => {
    const basis = crm();
    const aus = kiAntwortNormalisieren(
      {
        aenderungen: [
          { schluessel: "bemerkungen:text:text", wert: "Hof freihalten." },
          { schluessel: "anschreiben:einleitung:text", wert: "Erster Satz." },
          { schluessel: "anschreiben:einleitung:text", wert: "  Wir kommen am Dienstag.  " },
          { schluessel: "bilder:fehlt:zeigen", wert: false },
        ],
      },
      basis,
      { "anschreiben:einleitung:text": "Zwischenstand", "bemerkungen:text:text": "Hof freihalten." }
    );
    expect(aus.antwort).toBe("Hier ist mein Vorschlag.");
    expect(aus.vorschlaege).toEqual([
      {
        schluessel: "anschreiben:einleitung:text",
        wert: "Wir kommen am Dienstag.",
        vorher: "Zwischenstand",
      },
    ]);
    expect(aus.abgelehnt).toEqual([{ schluessel: "bilder:fehlt:zeigen", grund: "UNBEKANNT" }]);
  });

  it("setzt einen Gedankenstrich im Wert zum Komma und blendet ein Bild aus", () => {
    const basis = vps();
    const aus = kiAntwortNormalisieren(
      {
        antwort: "  ",
        aenderungen: [
          { schluessel: "leistungen:transport:notiz", wert: "Schwer \u2014 vorsichtig" },
          { schluessel: "bilder:bild-03:zeigen", wert: false },
        ],
      },
      basis,
      { "leistungen:transport:notiz": "Schon geändert" }
    );
    expect(aus.antwort).toBe("Hier ist mein Vorschlag.");
    expect(aus.vorschlaege).toEqual([
      {
        schluessel: "leistungen:transport:notiz",
        wert: "Schwer, vorsichtig",
        vorher: "Schon geändert",
      },
      { schluessel: "bilder:bild-03:zeigen", wert: false, vorher: true },
    ]);
    expect(aus.abgelehnt).toEqual([]);
  });

  it("kürzt die Antwort auf 2000 Zeichen und hängt den Leertext danach an", () => {
    const basis = vps();
    const lang = `${"a".repeat(1998)}\u2014${"b".repeat(50)}`;
    const gekuerzt = kiAntwortNormalisieren({ antwort: lang, aenderungen: [] }, basis, {});
    expect(gekuerzt.antwort).toBe(`${"a".repeat(1998)}, `);
    expect(gekuerzt.antwort).toHaveLength(2000);
    expect(gekuerzt.abgelehnt).toEqual([]);

    const mitLeer = kiAntwortNormalisieren(
      { antwort: "a".repeat(2000), aenderungen: [{ schluessel: "gibt:es:nicht", wert: "x" }] },
      basis,
      {}
    );
    expect(mitLeer.antwort).toBe(`${"a".repeat(2000)}\n\n${KV_KI_LEER_TEXT}`);
  });

  it("setzt bei fehlender Antwort den Standardtext oder den Leertext", () => {
    const basis = crm();
    const mit = kiAntwortNormalisieren(
      { aenderungen: [{ schluessel: "bemerkungen:text:text", wert: "Hof freihalten." }] },
      basis,
      {}
    );
    expect(mit.antwort).toBe("Hier ist mein Vorschlag.");
    expect(mit.vorschlaege).toEqual([
      {
        schluessel: "bemerkungen:text:text",
        wert: "Hof freihalten.",
        vorher: "Bitte die Klingel nutzen.",
      },
    ]);

    const ohne = kiAntwortNormalisieren({ aenderungen: [] }, basis, {});
    expect(ohne).toEqual({ antwort: KV_KI_LEER_TEXT, vorschlaege: [], abgelehnt: [] });

    const nichts = kiAntwortNormalisieren(
      { aenderungen: [{ schluessel: "gibt:es:nicht", wert: "x" }] },
      basis,
      {}
    );
    expect(nichts.antwort).toBe(KV_KI_LEER_TEXT);
    expect(nichts.vorschlaege).toEqual([]);
    expect(nichts.abgelehnt).toEqual([
      { schluessel: "gibt:es:nicht", grund: "UNBEKANNT" },
      { schluessel: null, grund: "LEER" },
    ]);
  });
});

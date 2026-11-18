import { describe, expect, it } from "vitest";
import { KV_EDITOR_TEXT, type KvAenderung, type KvBasis } from "@/lib/kv-editor";
import { basisCrm, basisVps } from "./kv-editor-fixture";
import {
  abgelehntAusDaten,
  dreiwege,
  eingabeZuWerten,
  fehlerJeFeld,
  firmaName,
  formularAbschnitte,
  formularEingabe,
  lokalePruefung,
  mergeEingabe,
  mergeVollstaendig,
  werteAusListe,
  wertText,
  zeichenRest,
  zustaendigOptionen,
} from "./kv-formular-logik";

const basis = basisVps();
const f = (k: string) => basis.felder.find((x) => x.schluessel === k)!;
const ae = (schluessel: string, wert: KvAenderung["wert"], vorher: KvAenderung["wert"] = ""): KvAenderung => ({
  schluessel,
  wert,
  vorher,
  quelle: "hand",
  von: "u",
  am: "2026-11-18T13:00:00Z",
});

describe("formularAbschnitte", () => {
  it("in KV-Reihenfolge, Gruppen zusammen, lose Felder einzeln", () => {
    const a = formularAbschnitte(basis);
    expect(a.map((x) => x.titel)).toEqual(["Projektübersicht", "Unsere Leistungen", "Umzugsgut", "Ihre Bilder", "Ergänzende Vereinbarungen"]);
    const leistungen = a.find((x) => x.abschnitt === "leistungen")!;
    expect(leistungen.zeilen.map((z) => [z.gruppe, z.felder.length])).toEqual([
      ["Transport", 2],
      ["Möbelmontage", 2],
      ["Halteverbot Auszug", 2],
    ]);
    expect(a[0].zeilen.every((z) => z.gruppe === null && z.felder.length === 1)).toBe(true);
  });

  it("CRM: Anschreiben vorne mit Einleitung und Schluss, dann Leistung und Bemerkungen", () => {
    expect(formularAbschnitte(basisCrm()).map((x) => [x.titel, x.zeilen.flatMap((z) => z.felder.map((y) => y.label))])).toEqual([
      ["Anschreiben", ["Einleitung", "Schluss"]],
      ["Projektübersicht", ["Leistung"]],
      ["Bemerkungen", ["Bemerkungen"]],
    ]);
  });
});

describe("formularEingabe", () => {
  const werte = werteAusListe(basis, [ae("uebersicht:termin:zeit", "ab 7:30 Uhr", "ab 8:00 Uhr")]);

  it("unverändert: nichts; neuer Wert: setzen (getrimmt); zurück auf Basis: zuruecksetzen", () => {
    expect(formularEingabe(basis, werte, {}, "st_3")).toEqual({ vorgaengerId: "st_3", setzen: [], zuruecksetzen: [] });
    expect(
      formularEingabe(
        basis,
        werte,
        {
          "uebersicht:termin:zeit": "ab 8:00 Uhr ",
          "vereinbarungen:text:text": "  Keller leer  ",
          "uebersicht:auszug:details": "3. OG ohne Aufzug",
          "bilder:att_flur:zeigen": false,
        },
        "st_3"
      )
    ).toEqual({
      vorgaengerId: "st_3",
      setzen: [
        { schluessel: "bilder:att_flur:zeigen", wert: false },
        { schluessel: "vereinbarungen:text:text", wert: "Keller leer" },
      ],
      zuruecksetzen: ["uebersicht:termin:zeit"],
    });
  });

  it("Schlüssel außerhalb des Katalogs werden nicht geschickt", () => {
    expect(formularEingabe(basis, werte, { "preise:gesamt:betrag": "1" }, "st_3").setzen).toEqual([]);
  });
});

describe("lokalePruefung und Fehler", () => {
  it("zu lang, Firma ohne Preis, falscher Typ, Bild nicht neu zeigen", () => {
    const b: KvBasis = { ...basis, felder: [...basis.felder, { ...f("bilder:att_flur:zeigen"), schluessel: "bilder:att_neu:zeigen", basis: false }] };
    expect(
      lokalePruefung(b, {
        "uebersicht:termin:zeit": "x".repeat(121),
        "leistungen:assembly:zustaendig": "company",
        "leistungen:transport:zustaendig": "egal",
        "vereinbarungen:text:text": true,
        "bilder:att_neu:zeigen": true,
        "leistungen:transport:notiz": "  ok  ",
      })
    ).toEqual({
      "uebersicht:termin:zeit": "ZU_LANG",
      "leistungen:assembly:zustaendig": "FIRMA_GESPERRT",
      "leistungen:transport:zustaendig": "TYP",
      "vereinbarungen:text:text": "TYP",
      "bilder:att_neu:zeigen": "UNBEKANNT",
    });
    // Genau an der Grenze und mit Leerzeichen außen: erlaubt.
    expect(lokalePruefung(basis, { "uebersicht:termin:zeit": ` ${"x".repeat(120)} ` })).toEqual({});
    // Firma zurück, wo sie im Preis ist: erlaubt.
    expect(lokalePruefung(basis, { "leistungen:transport:zustaendig": "company" })).toEqual({});
  });

  it("Ablehnungen des Servers je Feld und allgemein, Texte aus KV_EDITOR_TEXT", () => {
    const r = fehlerJeFeld(
      [
        { schluessel: "vereinbarungen:text:text", grund: "PREIS" },
        { schluessel: null, grund: "UNBEKANNT" },
        { schluessel: "preise:x:y", grund: "UNBEKANNT" },
        { schluessel: "uebersicht:termin:zeit", grund: "NICHT_VORGESCHLAGEN" },
      ],
      basis
    );
    expect(r.jeFeld).toEqual({ "vereinbarungen:text:text": KV_EDITOR_TEXT.PREIS, "uebersicht:termin:zeit": KV_EDITOR_TEXT.NICHT_VORGESCHLAGEN });
    expect(r.allgemein).toEqual([KV_EDITOR_TEXT.UNBEKANNT]);
  });

  it("abgelehntAusDaten liest UNGUELTIG robust", () => {
    expect(abgelehntAusDaten({ abgelehnt: [{ schluessel: "a:b:c", grund: "PREIS" }, { grund: "QUATSCH" }, null] })).toEqual([{ schluessel: "a:b:c", grund: "PREIS" }]);
    expect(abgelehntAusDaten(undefined)).toEqual([]);
    expect(abgelehntAusDaten({ abgelehnt: "nein" })).toEqual([]);
  });
});

describe("Zuständigkeit und Anzeige", () => {
  it("Firma ausgegraut, wo sie nicht im Preis ist; Name je Firma", () => {
    expect(zustaendigOptionen(f("leistungen:assembly:zustaendig"), "kottke")).toEqual([
      { wert: "company", label: "Kottke", gesperrt: true },
      { wert: "customer", label: "Kunde", gesperrt: false },
      { wert: "none", label: "Entfällt", gesperrt: false },
    ]);
    expect(zustaendigOptionen(f("leistungen:transport:zustaendig"), "ceylan")[0]).toEqual({ wert: "company", label: "Ceylan", gesperrt: false });
    expect(firmaName(null)).toBe("Wir");
  });

  it("wertText und Zeichenzähler", () => {
    expect(wertText("company", "zustaendig", "kottke")).toBe("Kottke");
    expect(wertText("customer", "zustaendig", null)).toBe("Kunde");
    expect(wertText(false, "zeigen", null)).toBe("ausgeblendet");
    expect(wertText("  ", "text", null)).toBe("leer");
    expect(wertText(null, null, null)).toBe("fehlt");
    expect(zeichenRest(f("uebersicht:termin:zeit"), " ab 9 ")).toBe("4 / 120");
    expect(zeichenRest(f("leistungen:transport:zustaendig"), "company")).toBeNull();
  });
});

describe("Als neuen Entwurf verwenden", () => {
  it("Liste eines älteren Stands auf den neuesten: setzen und zurücksetzen", () => {
    const neuester = [ae("uebersicht:termin:zeit", "ab 7:30 Uhr", "ab 8:00 Uhr"), ae("vereinbarungen:text:text", "Keller")];
    const alt = [ae("uebersicht:termin:zeit", "ab 7:00 Uhr", "ab 8:00 Uhr"), ae("leistungen:transport:notiz", "Zwei Wagen")];
    expect(eingabeZuWerten(basis, neuester, werteAusListe(basis, alt), "st_5")).toEqual({
      vorgaengerId: "st_5",
      setzen: [
        { schluessel: "uebersicht:termin:zeit", wert: "ab 7:00 Uhr" },
        { schluessel: "leistungen:transport:notiz", wert: "Zwei Wagen" },
      ],
      zuruecksetzen: ["vereinbarungen:text:text"],
    });
  });
});

describe("Zusammenführen (STAND_VERALTET)", () => {
  const gemeinsam = [ae("uebersicht:termin:zeit", "ab 7:30 Uhr", "ab 8:00 Uhr")];
  const deren = [ae("uebersicht:termin:zeit", "ab 7:00 Uhr", "ab 8:00 Uhr"), ae("umzugsgut:inv_sofa:notiz", "Füße ab"), ae("vereinbarungen:text:text", "Keller")];

  it("nur eine Seite geändert bleibt, beide gleich zählt einmal, beide verschieden ist Konflikt", () => {
    const e = dreiwege(
      basis,
      gemeinsam,
      {
        "uebersicht:termin:zeit": "ab 10:00 Uhr", // beide geändert, verschieden → Konflikt
        "vereinbarungen:text:text": "Keller", // beide gleich
        "leistungen:transport:notiz": "Zwei Wagen", // nur ich
      },
      deren
    );
    expect(e.meineUebernommen).toEqual(["leistungen:transport:notiz"]);
    expect(e.konflikte.map((k) => [k.schluessel, k.meins, k.deren, k.gemeinsam])).toEqual([["uebersicht:termin:zeit", "ab 10:00 Uhr", "ab 7:00 Uhr", "ab 7:30 Uhr"]]);
    expect(e.werte["umzugsgut:inv_sofa:notiz"]).toBe("Füße ab");
    expect(e.werte["vereinbarungen:text:text"]).toBe("Keller");
    expect(mergeVollstaendig(e, {})).toBe(false);

    const neuester = { id: "st_4", aenderungen: deren };
    expect(mergeEingabe(basis, e, { "uebersicht:termin:zeit": "meins" }, neuester)).toEqual({
      vorgaengerId: "st_4",
      setzen: [
        { schluessel: "uebersicht:termin:zeit", wert: "ab 10:00 Uhr" },
        { schluessel: "leistungen:transport:notiz", wert: "Zwei Wagen" },
      ],
      zuruecksetzen: [],
    });
    expect(mergeEingabe(basis, e, { "uebersicht:termin:zeit": "deren" }, neuester).setzen).toEqual([{ schluessel: "leistungen:transport:notiz", wert: "Zwei Wagen" }]);
  });

  it("ich setze zurück, die anderen ändern nichts: zurücksetzen auf dem neuesten", () => {
    const e = dreiwege(basis, gemeinsam, { "uebersicht:termin:zeit": "ab 8:00 Uhr" }, gemeinsam);
    expect(e.konflikte).toEqual([]);
    expect(mergeEingabe(basis, e, {}, { id: "st_4", aenderungen: gemeinsam })).toEqual({ vorgaengerId: "st_4", setzen: [], zuruecksetzen: ["uebersicht:termin:zeit"] });
  });
});

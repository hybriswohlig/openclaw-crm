import { describe, expect, it } from "vitest";
import type { GrundlageFeld } from "@/lib/kalkulations-ansicht";
import { eingabenAus, geaenderteFelder, textAus } from "./eingabe-felder";

/** Beladen-Zeile eines Leads ohne Tragweg (Tragweg Standard des Rechners). */
const BELADEN: GrundlageFeld[] = [
  { key: "beladen.etage", label: "Etage", typ: "zahl", wert: 2 },
  { key: "beladen.aufzug", label: "Aufzug", typ: "aufzug", wert: "keiner" },
  { key: "beladen.tragweg", label: "Tragweg in m", typ: "zahl", wert: null },
];

const HALTEVERBOT: GrundlageFeld[] = [
  { key: "halteverbot.beladen", label: "beim Beladen", typ: "ja_nein", wert: true },
  { key: "halteverbot.entladen", label: "beim Entladen", typ: "ja_nein", wert: false },
];

describe("textAus und eingabenAus", () => {
  it("Zahlen mit Komma, Aufzug ohne Wert als keiner, leere Zahl leer, ja/nein als Schalter", () => {
    expect(textAus({ typ: "zahl", wert: 2.5 })).toBe("2,5");
    expect(textAus({ typ: "aufzug", wert: null })).toBe("keiner");
    expect(textAus({ typ: "zahl", wert: null })).toBe("");
    expect(textAus({ typ: "datum", wert: "2026-11-21" })).toBe("2026-11-21");
    expect(eingabenAus(HALTEVERBOT)).toEqual({
      texte: { "halteverbot.beladen": "ja", "halteverbot.entladen": "nein" },
      schalter: { "halteverbot.beladen": true, "halteverbot.entladen": false },
    });
  });
});

describe("geaenderteFelder", () => {
  it("leeres Feld ohne alten Wert zählt als unverändert: Etage lässt sich ohne Tragweg speichern (I1)", () => {
    const e = eingabenAus(BELADEN);
    e.texte["beladen.etage"] = "3";
    expect(geaenderteFelder(BELADEN, e, "Kunde sagt 3. OG")).toEqual({ ok: true, liste: [{ key: "beladen.etage", wert: 3 }] });
  });

  it("nichts geändert ergibt eine leere Liste; Grund ist Pflicht", () => {
    expect(geaenderteFelder(BELADEN, eingabenAus(BELADEN), "x")).toEqual({ ok: true, liste: [] });
    expect(geaenderteFelder(BELADEN, eingabenAus(BELADEN), "  ")).toEqual({ ok: false, meldung: "Bitte einen Grund angeben." });
  });

  it("prüft mit den Regeln des Servers, bevor etwas gesendet wird (M5)", () => {
    const e = eingabenAus(BELADEN);
    e.texte["beladen.etage"] = "3";
    e.texte["beladen.tragweg"] = "-5";
    expect(geaenderteFelder(BELADEN, e, "g")).toEqual({ ok: false, meldung: "Tragweg in m: Tragweg darf nicht negativ sein." });
    e.texte["beladen.tragweg"] = "";
    e.texte["beladen.etage"] = "2,55";
    expect(geaenderteFelder(BELADEN, e, "g").ok).toBe(false);
    const team: GrundlageFeld[] = [{ key: "team", label: "Team", typ: "ganzzahl", wert: 3 }];
    expect(geaenderteFelder(team, { texte: { team: "25" }, schalter: {} }, "g")).toEqual({
      ok: false,
      meldung: "Team: Team muss eine ganze Zahl von 1 bis 20 sein.",
    });
    expect(geaenderteFelder(team, { texte: { team: "4,5" }, schalter: {} }, "g")).toEqual({ ok: false, meldung: "Team: Team muss eine ganze Zahl von 1 bis 20 sein." });
    expect(geaenderteFelder(team, { texte: { team: "abc" }, schalter: {} }, "g")).toEqual({ ok: false, meldung: "Team: bitte eine ganze Zahl eingeben." });
    const volumen: GrundlageFeld[] = [{ key: "volumen", label: "Volumen in m³", typ: "zahl", wert: 38 }];
    expect(geaenderteFelder(volumen, { texte: { volumen: "0" }, schalter: {} }, "g")).toEqual({
      ok: false,
      meldung: "Volumen in m³: Volumen muss größer als 0 sein.",
    });
    expect(geaenderteFelder(volumen, { texte: { volumen: "40,5" }, schalter: {} }, "g")).toEqual({ ok: true, liste: [{ key: "volumen", wert: 40.5 }] });
  });

  it("Schalter, Aufzug und Datum: nur geänderte Felder, Aufzug normalisiert", () => {
    const e = eingabenAus(HALTEVERBOT);
    e.schalter["halteverbot.entladen"] = true;
    expect(geaenderteFelder(HALTEVERBOT, e, "g")).toEqual({ ok: true, liste: [{ key: "halteverbot.entladen", wert: true }] });
    const b = eingabenAus(BELADEN);
    b.texte["beladen.aufzug"] = "gross";
    expect(geaenderteFelder(BELADEN, b, "g")).toEqual({ ok: true, liste: [{ key: "beladen.aufzug", wert: "gross" }] });
    const termin: GrundlageFeld[] = [{ key: "termin", label: "Termin", typ: "datum", wert: "2026-11-21" }];
    expect(geaenderteFelder(termin, { texte: { termin: "2026-11-21" }, schalter: {} }, "g")).toEqual({ ok: true, liste: [] });
    expect(geaenderteFelder(termin, { texte: { termin: "2026-11-28" }, schalter: {} }, "g")).toEqual({ ok: true, liste: [{ key: "termin", wert: "2026-11-28" }] });
    expect(geaenderteFelder(termin, { texte: { termin: "" }, schalter: {} }, "g")).toEqual({ ok: false, meldung: "Termin: bitte ein Datum wählen." });
  });
});

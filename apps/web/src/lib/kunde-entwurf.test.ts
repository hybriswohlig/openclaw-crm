import { describe, expect, it } from "vitest";
import type { DealKunde, KundeVorschlag } from "./deal-kunde";
import { aenderungen, entwurfAus, feldLeer, vorschlagEinsetzen, vorschlagHinweis } from "./kunde-entwurf";

const KUNDE: DealKunde = {
  personId: "p1",
  name: "Viktoria",
  nameAusPerson: true,
  telefon: "0171 2345678",
  email: null,
  auszug: null,
  einzug: { strasse: "", plz: "71032", ort: "Böblingen" },
  datum: "2026-11-28",
};

const vorschlag = (v: Partial<KundeVorschlag>): KundeVorschlag => ({
  quelle: "ki",
  name: null,
  email: null,
  telefon: null,
  auszug: null,
  einzug: null,
  hinweis: null,
  ...v,
});

describe("Entwurf", () => {
  it("leere Adresse braucht PLZ und Ort", () => {
    const e = entwurfAus(KUNDE);
    expect(feldLeer(e, "auszug")).toBe(true);
    expect(feldLeer(e, "einzug")).toBe(false);
    expect(feldLeer(e, "email")).toBe(true);
  });

  it("Vorschläge ersetzen Werte zum Prüfen und melden die Felder", () => {
    const { entwurf, gesetzt } = vorschlagEinsetzen(
      entwurfAus(KUNDE),
      vorschlag({
        name: "Viktoria Muster",
        email: "v@beispiel.de",
        telefon: "0171 2345678",
        auszug: { strasse: "Hauptstr. 1", plz: "72218", ort: "Wildberg" },
        einzug: { strasse: "", plz: "71032", ort: "Böblingen" },
      })
    );
    expect(gesetzt).toEqual(["name", "email", "auszug"]);
    expect(entwurf.name).toBe("Viktoria Muster");
    expect(entwurf.auszug).toEqual({ strasse: "Hauptstr. 1", plz: "72218", ort: "Wildberg" });
  });

  it("nur die erlaubten Felder (Vorprüfung zeigt nur, was fehlt)", () => {
    const { gesetzt } = vorschlagEinsetzen(
      entwurfAus(KUNDE),
      vorschlag({ name: "Viktoria Muster", auszug: { strasse: "", plz: "72218", ort: "Wildberg" } }),
      ["auszug"]
    );
    expect(gesetzt).toEqual(["auszug"]);
  });

  it("eine erkannte PLZ ohne Straße behält die eingetragene Straße derselben PLZ", () => {
    const e = { ...entwurfAus(KUNDE), auszug: { strasse: "Hauptstr. 1", plz: "72218", ort: "Wildberg" } };
    const r = vorschlagEinsetzen(e, vorschlag({ quelle: "erkennung", auszug: { strasse: "", plz: "72218", ort: "Wildberg" } }));
    expect(r.gesetzt).toEqual([]);
    const anders = vorschlagEinsetzen(e, vorschlag({ quelle: "erkennung", auszug: { strasse: "", plz: "70372", ort: "Stuttgart" } }));
    expect(anders.entwurf.auszug).toEqual({ strasse: "", plz: "70372", ort: "Stuttgart" });
  });

  it("Änderungen: nur geänderte und gefüllte Felder", () => {
    const e = { ...entwurfAus(KUNDE), auszug: { strasse: " Hauptstr. 1 ", plz: "72218", ort: "Wildberg" }, telefon: "" };
    expect(aenderungen(e, KUNDE)).toEqual({ auszug: { strasse: "Hauptstr. 1", plz: "72218", ort: "Wildberg" } });
    expect(aenderungen(e, KUNDE, ["name", "telefon"])).toEqual({});
    expect(aenderungen({ ...e, name: "Viktoria Muster" }, KUNDE, ["name"])).toEqual({ name: "Viktoria Muster" });
  });

  it("Hinweistexte", () => {
    expect(vorschlagHinweis(vorschlag({}), [])).toBe("Im Chat steht nichts Neues zu Name, Adresse oder E-Mail.");
    expect(vorschlagHinweis(vorschlag({ quelle: "erkennung" }), ["auszug"])).toBe(
      "Ein Feld aus den Nachrichten erkannt, nur PLZ und Ort eingesetzt. Bitte prüfen, gespeichert wird erst mit „Speichern“."
    );
  });
});

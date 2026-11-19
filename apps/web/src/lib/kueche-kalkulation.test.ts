/**
 * Küchenmontage in der Kalkulation (Inhaber 19.11.): Leistung umstellbar, Meter für Küchenzeile
 * und Oberschränke, Einbauort statt Be-/Entladen, KV-Posten und Küchenblock fürs Angebot.
 */
import { describe, expect, it } from "vitest";
import { rechnerAnfrageAus, type LeadDaten } from "@/services/rechner/eingabe";
import { kuechenTitel } from "@/services/rechner/kv-posten";
import { kuechenAngaben } from "@/services/rechner/uebernahme";
import { kuecheZusammen } from "@/services/document-job-context";
import type { RechnerErgebnis } from "@/services/rechner/client";
import { auftragsartAus } from "./auftragsart";
import { anfrageMitUebersteuerungen, grundlageAus, pruefeUebersteuerung, rechnerwertFuer, type Uebersteuerung } from "./kalkulation-versionen";
import { geaenderteFelder } from "@/components/neu/kalkulation/eingabe-felder";

function lead(teil: Partial<LeadDaten> = {}): LeadDaten {
  return {
    von: "Hauptstr. 1, 71032 Böblingen",
    nach: "Marktplatz 2, 70173 Stuttgart",
    etageVon: 3,
    etageNach: 1,
    zugangVon: null,
    zugangNach: null,
    umzugsdatum: "2026-12-01",
    wohnflaecheQm: null,
    zimmer: null,
    tragestreckeVonM: 15,
    tragestreckeNachM: 5,
    halteverbot: false,
    halteverbotNach: true,
    packService: false,
    kartons: null,
    inventar: [],
    ...teil,
  };
}

function ue(key: string, wert: Uebersteuerung["wert"], zeit = "2026-11-19T10:00:00.000Z"): Uebersteuerung {
  return {
    id: `u-${key}`,
    art: "eingabe",
    key,
    rechnerwert: null,
    wert,
    grund: "Kunde am Telefon",
    autor: { userId: "u1", quelle: "mensch" },
    zeit,
    fotoRef: null,
  };
}

const ERGEBNIS = { kueche: { meter: 3.2, meterOben: 1.8 } } as unknown as RechnerErgebnis;

describe("Küchenmontage: Rechner-Anfrage", () => {
  it("ein Ort: Von-Seite ist der Einbauort, keine Zielseite, Standard Aufbau und Hochtragen", () => {
    const a = rechnerAnfrageAus(lead({ auftragsart: "kuechenmontage" }));
    expect(a.auftragsart).toBe("kuechenmontage");
    expect(a.von_adresse).toBe("Hauptstr. 1, 71032 Böblingen");
    expect(a.von_etage).toBe("3");
    expect(Object.keys(a).filter((k) => k.startsWith("nach_"))).toEqual([]);
    expect(a.kueche_montage).toBe("on");
    expect(a.kueche_hochtragen).toBe("on");
    expect(a.kueche_demontage).toBeUndefined();
  });

  it("nur Einzugsadresse im Lead: sie wird zum Einbauort", () => {
    const a = rechnerAnfrageAus(lead({ auftragsart: "kuechenmontage", von: null, etageVon: null, tragestreckeVonM: null }));
    expect(a.von_adresse).toBe("Marktplatz 2, 70173 Stuttgart");
    expect(a.von_etage).toBe("1");
    expect(a.von_tragestrecke).toBe("5");
    expect(a.von_halteverbot).toBe("on");
    expect(Object.keys(a).filter((k) => k.startsWith("nach_"))).toEqual([]);
  });

  it("Umzug bleibt unverändert (keine Küchenfelder)", () => {
    const a = rechnerAnfrageAus(lead({ auftragsart: "umzug" }));
    expect(a.kueche_montage).toBeUndefined();
    expect(a.nach_adresse).toBe("Marktplatz 2, 70173 Stuttgart");
  });
});

describe("Küchenmontage: Übersteuerungen", () => {
  const heute = { referenceDate: "2026-11-19" };

  it("Leistung auf Küchenmontage stellt eine Umzugs-Anfrage um, Meter und Schalter gehen an den Rechner", () => {
    const basis = rechnerAnfrageAus(lead({ auftragsart: "umzug" }));
    const a = anfrageMitUebersteuerungen(
      basis,
      [ue("leistung", "kuechenmontage"), ue("kueche.meter", 3.2), ue("kueche.meter_oben", 1.8), ue("kueche.abbau", true), ue("entladen.etage", 4)],
      heute
    );
    expect(a.auftragsart).toBe("kuechenmontage");
    expect(a.kueche_meter).toBe("3.2");
    expect(a.kueche_meter_oben).toBe("1.8");
    expect(a.kueche_demontage).toBe("on");
    expect(a.kueche_montage).toBe("on");
    expect(a.kueche_hochtragen).toBe("on");
    // Entladen gilt bei Küchenmontage nicht.
    expect(Object.keys(a).filter((k) => k.startsWith("nach_"))).toEqual([]);
  });

  it("Hochtragen und Aufbau lassen sich abschalten", () => {
    const basis = rechnerAnfrageAus(lead({ auftragsart: "kuechenmontage" }));
    const a = anfrageMitUebersteuerungen(basis, [ue("kueche.hochtragen", false), ue("kueche.aufbau", false)], heute);
    expect(a.kueche_hochtragen).toBeUndefined();
    expect(a.kueche_montage).toBeUndefined();
  });

  it("zurück auf Umzug: Küchen-Standards weg, Zielseite an", () => {
    const basis = rechnerAnfrageAus(lead({ auftragsart: "kuechenmontage" }));
    const a = anfrageMitUebersteuerungen(basis, [ue("leistung", "umzug")], heute);
    expect(a.auftragsart).toBe("umzug");
    expect(a.kueche_montage).toBeUndefined();
    expect(a.kueche_hochtragen).toBeUndefined();
    expect(a.nach_vorhanden).toBe("on");
  });

  it("Prüfung: Meter 0 bis 50, Schalter ja/nein, nur bekannte Leistungen", () => {
    expect(pruefeUebersteuerung({ art: "eingabe", key: "kueche.meter", wert: "3,25", grund: "x" }).wert).toBe(3.25);
    expect(() => pruefeUebersteuerung({ art: "eingabe", key: "kueche.meter_oben", wert: 51, grund: "x" })).toThrow(/Küchenmeter/);
    expect(() => pruefeUebersteuerung({ art: "eingabe", key: "kueche.abbau", wert: "ja", grund: "x" })).toThrow(/ja oder nein/);
    expect(pruefeUebersteuerung({ art: "eingabe", key: "leistung", wert: "kuechenmontage", grund: "x" }).wert).toBe("kuechenmontage");
    expect(() => pruefeUebersteuerung({ art: "eingabe", key: "leistung", wert: "transport", grund: "x" })).toThrow(/Leistung/);
  });

  it("Grundlage: Standards je Leistung, Rechnerwert der Schalter aus der Anfrage", () => {
    const g = grundlageAus(lead({ auftragsart: "kuechenmontage" }), null, []);
    const w = (k: string) => g.find((z) => z.key === k);
    expect(w("leistung")).toMatchObject({ wert: "kuechenmontage", herkunft: "REGEL" });
    expect(w("kueche.aufbau")).toMatchObject({ wert: true, herkunft: "REGEL" });
    expect(w("kueche.abbau")).toMatchObject({ wert: false, herkunft: "STANDARD" });
    const umzug = grundlageAus(lead({ auftragsart: "umzug" }), null, [ue("leistung", "kuechenmontage")]);
    expect(umzug.find((z) => z.key === "leistung")).toMatchObject({ wert: "kuechenmontage", herkunft: "MANUELL" });
    expect(umzug.find((z) => z.key === "kueche.hochtragen")).toMatchObject({ wert: true });

    const a = rechnerAnfrageAus(lead({ auftragsart: "kuechenmontage" }));
    expect(rechnerwertFuer("eingabe", "kueche.hochtragen", a, null)).toBe(true);
    expect(rechnerwertFuer("eingabe", "kueche.abbau", a, null)).toBe(false);
    expect(rechnerwertFuer("eingabe", "leistung", a, null)).toBe("kuechenmontage");
  });

  it("Eingabe-Dialog: Leistung als Auswahl", () => {
    const felder = [{ key: "leistung" as const, label: "Leistung", typ: "leistung" as const, wert: "umzug" }];
    expect(geaenderteFelder(felder, { texte: { leistung: "kuechenmontage" }, schalter: {} }, "Küche")).toEqual({
      ok: true,
      liste: [{ key: "leistung", wert: "kuechenmontage" }],
    });
    expect(geaenderteFelder(felder, { texte: { leistung: "umzug" }, schalter: {} }, "Küche")).toEqual({ ok: true, liste: [] });
  });
});

describe("Küchenmontage: Leistung erkennen", () => {
  it("Lead-Typ Küche, gespeichertes Angebot gewinnt", () => {
    expect(auftragsartAus({ gespeichert: null, leadType: "Kuechenmontage" })).toBe("kuechenmontage");
    expect(auftragsartAus({ gespeichert: null, leadType: null, text: "Wir brauchen eine Küchenmontage im 2. OG" })).toBe("kuechenmontage");
    expect(auftragsartAus({ gespeichert: "clearance", leadType: "Küche" })).toBe("entruempelung");
    expect(auftragsartAus({ gespeichert: null, leadType: null, text: "Umzug mit Küche abbauen" })).toBe("umzug");
  });
});

describe("Küchenmontage: KV", () => {
  it("Postentitel mit Metern und Arbeiten", () => {
    expect(kuechenTitel({ kueche_montage: "on" }, 3.2, 1.8, true)).toBe("Küchenmontage: Aufbau (3,2 m Küchenzeile, 1,8 m Oberschränke)");
    expect(kuechenTitel({ kueche_montage: "on", kueche_demontage: "on" }, 4, null, false)).toBe("Küche: Abbau und Aufbau (4 m Küchenzeile)");
  });

  it("Küchenblock fürs Angebot: Einbauort, Maße, wer was macht", () => {
    const a = rechnerAnfrageAus(lead({ auftragsart: "kuechenmontage", zugangVon: "Kein Aufzug" }));
    a.kueche_demontage = "on";
    const k = kuechenAngaben(a, ERGEBNIS)!;
    expect(k.address).toBe("Hauptstr. 1, 71032 Böblingen");
    expect(k.details).toContain("3. OG");
    expect(k.dimensions).toBe("Küchenzeile 3,2 m, Oberschränke 1,8 m (laufende Meter)");
    expect(k.services?.oldKitchenDismantling.owner).toBe("company");
    expect(k.services?.delivery.owner).toBe("company");
    expect(k.services?.installation.owner).toBe("company");
    expect(k.services?.connections.owner).toBe("none");
    expect(kuechenAngaben(rechnerAnfrageAus(lead({ auftragsart: "umzug" })), ERGEBNIS)).toBeNull();
  });

  it("Dialog und Angebot: Adresse/Termin aus dem Dialog, Maße und Leistungen aus dem Angebot", () => {
    const k = kuecheZusammen(
      { address: "Neue Str. 3", date: "2026-12-02", services: { installation: { owner: "company" } }, components: [] },
      { address: "Alte Str. 1", dimensions: "Küchenzeile 3 m", services: { installation: { owner: "company", note: "3 m" }, delivery: { owner: "company" } } }
    );
    expect(k).toMatchObject({ address: "Neue Str. 3", date: "2026-12-02", dimensions: "Küchenzeile 3 m" });
    expect(k?.services?.delivery?.owner).toBe("company");
    expect(kuecheZusammen(undefined, { address: "A" })).toEqual({ address: "A" });
  });
});

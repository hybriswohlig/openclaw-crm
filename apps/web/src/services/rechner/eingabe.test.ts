import { describe, expect, it } from "vitest";
import { buchungsAnteil, rechnerBuchungFeld } from "@/lib/einsatz";
import { eingabeHash, mitEinsatzFeldern, mitPlan5Feldern, rechnerAnfrageAus, type LeadDaten } from "./eingabe";

const leer: LeadDaten = {
  von: null, nach: null, etageVon: null, etageNach: null, zugangVon: null, zugangNach: null,
  umzugsdatum: null, wohnflaecheQm: null, zimmer: null, tragestreckeVonM: null, tragestreckeNachM: null,
  halteverbot: false, packService: false, kartons: null, inventar: [],
};

describe("rechnerAnfrageAus", () => {
  it("frischer Lead ohne Angaben: keine Etage, keine Adresse, nichts erfunden", () => {
    const a = rechnerAnfrageAus(leer);
    expect(a).not.toHaveProperty("von_etage");
    expect(a).not.toHaveProperty("von_adresse");
    expect(a.nach_vorhanden).toBeUndefined();
  });
  it("Zugang: Aufzug → klein, Treppe → keiner, Erdgeschoss → Etage 0", () => {
    const a = rechnerAnfrageAus({ ...leer, von: "Böblingen", nach: "Sindelfingen", zugangVon: "Aufzug", etageVon: 4, zugangNach: "Erdgeschoss" });
    expect(a).toMatchObject({ von_aufzug: "klein", von_etage: "4", nach_etage: "0", nach_aufzug: "keiner", nach_vorhanden: "on" });
  });
  it("eine eingetragene Etage schlägt die Etage aus der Zugangsart", () => {
    expect(rechnerAnfrageAus({ ...leer, zugangVon: "Erdgeschoss", etageVon: 2 })).toMatchObject({ von_etage: "2" });
  });
  it("Einfamilienhaus: Etage 0, kein Aufzug", () => {
    expect(rechnerAnfrageAus({ ...leer, zugangVon: "Nicht nötig (Einfamilienhaus)" })).toMatchObject({ von_etage: "0", von_aufzug: "keiner" });
  });
  it("Treppenhaus: Normal/Eng/Wendeltreppe → normal/eng/wendel, sonst nichts", () => {
    expect(rechnerAnfrageAus({ ...leer, treppenhausVon: "Wendeltreppe", treppenhausNach: "Eng" }))
      .toMatchObject({ von_treppenhaus: "wendel", nach_treppenhaus: "eng" });
    expect(rechnerAnfrageAus({ ...leer, treppenhausVon: "Normal" })).toMatchObject({ von_treppenhaus: "normal" });
    const a = rechnerAnfrageAus({ ...leer, treppenhausVon: "irgendwas" });
    expect(a).not.toHaveProperty("von_treppenhaus");
    expect(rechnerAnfrageAus(leer)).not.toHaveProperty("von_treppenhaus");
  });
  it("Wendeltreppe nur am Ziel aktiviert die Zielseite (Review Grok)", () => {
    expect(rechnerAnfrageAus({ ...leer, von: "Filderstadt", treppenhausNach: "Wendeltreppe" }))
      .toMatchObject({ nach_treppenhaus: "wendel", nach_vorhanden: "on" });
  });
  it("Halteverbot je Adresse: Abholung → von, Ziel → nach (Patrick wollte zwei Zonen)", () => {
    expect(rechnerAnfrageAus({ ...leer, von: "Stuttgart", nach: "Stuttgart", halteverbot: true, halteverbotNach: true }))
      .toMatchObject({ von_halteverbot: "on", nach_halteverbot: "on" });
    const nurZiel = rechnerAnfrageAus({ ...leer, von: "Stuttgart", halteverbotNach: true });
    expect(nurZiel).toMatchObject({ nach_halteverbot: "on", nach_vorhanden: "on" });
    expect(nurZiel).not.toHaveProperty("von_halteverbot");
    expect(rechnerAnfrageAus(leer)).not.toHaveProperty("nach_halteverbot");
  });
  it("unbekannte Zugangsart setzt nichts", () => {
    const a = rechnerAnfrageAus({ ...leer, zugangVon: "irgendwas" });
    expect(a).not.toHaveProperty("von_aufzug");
    expect(a).not.toHaveProperty("von_etage");
  });
  it("Inventar: bleibt-da-Zeilen fallen weg, der Rest geht als Freitext", () => {
    const a = rechnerAnfrageAus({ ...leer, inventar: [
      { name: "Sofa", menge: 1, groessenklasse: "gross", volumenCbm: 1.5, mitnehmen: true },
      { name: "Einbauküche", menge: 1, groessenklasse: null, volumenCbm: null, mitnehmen: false },
    ] });
    expect(a.positionen_freitext).toEqual([{ name: "Sofa", menge: 1, groessenklasse: "gross", volumenCbm: 1.5 }]);
  });
  it("Abbau und Aufbau gehen nur mit, wenn sie nicht beide none sind", () => {
    const basis = rechnerAnfrageAus({
      ...leer,
      inventar: [{ name: "Sofa", menge: 1, groessenklasse: "gross", volumenCbm: 1.5, mitnehmen: true, abbau: "none", aufbau: "none" }],
    });
    expect(basis.positionen_freitext).toEqual([{ name: "Sofa", menge: 1, groessenklasse: "gross", volumenCbm: 1.5 }]);
    const firma = rechnerAnfrageAus({
      ...leer,
      inventar: [{ name: "Schrank", menge: 1, groessenklasse: null, volumenCbm: null, mitnehmen: true, abbau: "company", aufbau: "customer" }],
    });
    expect(firma.positionen_freitext).toEqual([{ name: "Schrank", menge: 1, abbau: "company", aufbau: "customer", zerlegt: true }]);
    const kunde = rechnerAnfrageAus({
      ...leer,
      inventar: [{ name: "Regal", menge: 1, groessenklasse: null, volumenCbm: null, mitnehmen: true, abbau: "customer", aufbau: "none" }],
    });
    expect(kunde.positionen_freitext).toEqual([{ name: "Regal", menge: 1, abbau: "customer", aufbau: "none", zerlegt: false }]);
  });
  it("schickt immer den Schalter montage_je_position, auch ohne Inventar", () => {
    expect(rechnerAnfrageAus(leer).montage_je_position).toBe("1");
    const mit = rechnerAnfrageAus({
      ...leer,
      inventar: [{ name: "Schrank", menge: 1, groessenklasse: null, volumenCbm: null, mitnehmen: true, abbau: "company", aufbau: "company" }],
    });
    expect(mit.montage_je_position).toBe("1");
  });
  it("unbekannte Größenklasse wird nicht mitgeschickt (der Rechner würde sie ablehnen)", () => {
    const a = rechnerAnfrageAus({ ...leer, inventar: [{ name: "Kiste", menge: 2, groessenklasse: "riesig", volumenCbm: null, mitnehmen: true }] });
    expect(a.positionen_freitext).toEqual([{ name: "Kiste", menge: 2 }]);
  });
  it("Packservice mit Kartonzahl bucht den Einpackservice", () => {
    expect(rechnerAnfrageAus({ ...leer, packService: true, kartons: 40 })).toMatchObject({ einpack_kartons: "40" });
  });
  it("Wohnfläche, Zimmer, Datum und Tragestrecken werden übergeben", () => {
    expect(rechnerAnfrageAus({ ...leer, wohnflaecheQm: 70, zimmer: 3, umzugsdatum: "2026-10-14", tragestreckeVonM: 30 }))
      .toMatchObject({ wohnflaeche_qm: "70", zimmer: "3", umzugsdatum: "2026-10-14", von_tragestrecke: "30" });
  });
  it("Hash ist unabhängig von der Schlüsselreihenfolge und ändert sich mit der Eingabe", () => {
    expect(eingabeHash({ a: "1", b: "2" })).toBe(eingabeHash({ b: "2", a: "1" }));
    expect(eingabeHash({ a: "1" })).not.toBe(eingabeHash({ a: "2" }));
  });
  it("'innerhalb X' ohne Zieladresse: Zielseite aktiv, der Rechner nimmt denselben Ort (Review Sol)", () => {
    expect(rechnerAnfrageAus({ ...leer, von: "innerhalb Böblingen" })).toMatchObject({ nach_vorhanden: "on" });
  });
  it("Zieletage oder Zielzugang ohne Zieladresse: Zielseite aktiv, Angaben gehen mit (Review Sol)", () => {
    expect(rechnerAnfrageAus({ ...leer, von: "Böblingen", etageNach: 2, zugangNach: "Treppe" }))
      .toMatchObject({ nach_vorhanden: "on", nach_etage: "2", nach_aufzug: "keiner" });
  });
  it("Einpackservice ohne Kartonzahl wird markiert statt still weggelassen (Review Sol)", () => {
    const a = rechnerAnfrageAus({ ...leer, packService: true, kartons: null });
    expect(a).not.toHaveProperty("einpack_kartons");
    expect(a.einpack_ohne_anzahl).toBe("on");
  });
  it("Auftragsart geht nur mit, wenn sie gesetzt ist", () => {
    expect(rechnerAnfrageAus({ ...leer, auftragsart: "entruempelung" }).auftragsart).toBe("entruempelung");
    expect(rechnerAnfrageAus(leer)).not.toHaveProperty("auftragsart");
    expect(rechnerAnfrageAus({ ...leer, auftragsart: null })).not.toHaveProperty("auftragsart");
  });
});

describe("Marke, Quelle und heute", () => {
  it("schickt Marke, Quelle und heute mit; heute ändert den Hash nicht", () => {
    const a = rechnerAnfrageAus({ ...leer, marke: "kottke", quelle: "vergleichsportal" }, { heute: "2026-09-28" });
    expect(a.marke).toBe("kottke");
    expect(a.quelle).toBe("vergleichsportal");
    expect(a.heute).toBe("2026-09-28");
    const b = rechnerAnfrageAus({ ...leer, marke: "kottke", quelle: "vergleichsportal" }, { heute: "2026-09-29" });
    expect(eingabeHash(a)).toBe(eingabeHash(b));
    const c = rechnerAnfrageAus({ ...leer, marke: "kottke", quelle: "vergleichsportal", umzugsdatum: "2026-10-15" }, { heute: "2026-09-28" });
    expect(eingabeHash(c)).not.toBe(eingabeHash(a));
  });
  it("ohne Marke und Quelle: Felder fehlen", () => {
    const a = rechnerAnfrageAus(leer);
    expect(a.marke).toBeUndefined();
    expect(a.quelle).toBeUndefined();
  });
});

describe("Inventar-Quelle", () => {
  it("quelle der Inventarzeile geht nicht an den Rechner", () => {
    const a = rechnerAnfrageAus({
      ...leer,
      inventar: [{ name: "Sofa", menge: 1, groessenklasse: "gross", volumenCbm: 1.5, mitnehmen: true, quelle: "foto" }],
    });
    expect(a.positionen_freitext).toEqual([{ name: "Sofa", menge: 1, groessenklasse: "gross", volumenCbm: 1.5 }]);
  });
});

describe("mitPlan5Feldern (Plan 5b)", () => {
  const lead = { ...leer, von: "Böblingen", nach: "Stuttgart", zimmer: 3, umzugsdatum: "2026-11-21" };
  const AUS = { angebotAusKalkulation: false, tagespreise: false };
  // Fester Fingerabdruck dieser Anfrage, berechnet auf f70e6a72 (vor Task K): ändert er sich,
  // gilt jede alte Version als veraltet.
  const HASH_VOR_5B = "6687ece8f74cced2f78b27027e1c42ce3295c3411e9a869d2e30fef5e844d921";

  it("ohne Schalter: Anfrage und Hash unverändert, auch mit Stundenmodus und Tagen", () => {
    const a = rechnerAnfrageAus(lead);
    for (const p of [null, undefined, { schalter: AUS, stunden: true, tage: ["2026-11-21", "2026-11-22"] }]) {
      const b = mitPlan5Feldern(a, p);
      expect(b).toEqual(a);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      expect(eingabeHash(b)).toBe(HASH_VOR_5B);
    }
  });

  it("Angebot aus Kalkulation: paket_uebersteuerungen und zeilen_stabil; stunden_modus nur im Stundenmodus; Hash ändert sich", () => {
    const a = rechnerAnfrageAus(lead);
    const fest = mitPlan5Feldern(a, { schalter: { angebotAusKalkulation: true, tagespreise: false }, stunden: false, tage: ["2026-11-21"] });
    expect(fest).toMatchObject({ paket_uebersteuerungen: "1", zeilen_stabil: "1" });
    expect(fest).not.toHaveProperty("stunden_modus");
    expect(fest).not.toHaveProperty("tage");
    expect(eingabeHash(fest)).not.toBe(HASH_VOR_5B);
    const std = mitPlan5Feldern(a, { schalter: { angebotAusKalkulation: true, tagespreise: true }, stunden: true, tage: ["2026-11-21"] });
    expect(std.stunden_modus).toBe("1");
    // Keine Tagespreise im Stundenmodus (F15).
    expect(std).not.toHaveProperty("tage");
  });

  it("Tagespreise: tage nur mit Schalter und Tagen, sortiert und ohne Doppel; leere Liste schickt nichts", () => {
    const a = rechnerAnfrageAus(lead);
    const t = mitPlan5Feldern(a, { schalter: { angebotAusKalkulation: false, tagespreise: true }, stunden: false, tage: ["2026-11-22", "2026-11-21", "2026-11-22"] });
    expect(t.tage).toBe(JSON.stringify(["2026-11-21", "2026-11-22"]));
    expect(t).not.toHaveProperty("paket_uebersteuerungen");
    expect(mitPlan5Feldern(a, { schalter: { angebotAusKalkulation: false, tagespreise: true }, stunden: false, tage: [] })).toEqual(a);
  });
});

describe("mitEinsatzFeldern (Plan 12b)", () => {
  const basis = { von_adresse: "A", umzugsdatum: "2026-11-21", mietstation: "alt" } as Record<string, string>;
  const b = { id: "b1", von: "2026-11-17", bis: "2026-11-23", stationId: "st1", klasseId: "kl1" };
  const anteil = buchungsAnteil({ id: "b1", mieteCent: 45000, geplanteAuftraege: 4, inklusivKm: 800, mehrkmSatzCent: 38 });

  it("ohne Vorgabe und ohne Buchung: dieselbe Anfrage, derselbe Hash", () => {
    expect(mitEinsatzFeldern(basis, null)).toBe(basis);
    expect(mitEinsatzFeldern(basis, { station: null, klasse: null, buchung: null })).toBe(basis);
    expect(eingabeHash(mitEinsatzFeldern(basis, undefined))).toBe(eingabeHash(basis));
  });

  it("Station und Klasse als Vorgabe; Buchung gewinnt über beide und schickt das Feld buchung", () => {
    expect(mitEinsatzFeldern(basis, { station: "st9", klasse: "kl9", buchung: null })).toMatchObject({ mietstation: "st9", fahrzeugklasse: "kl9" });
    const mit = mitEinsatzFeldern(basis, { station: "st9", klasse: "kl9", buchung: { b, anteil } });
    expect(mit).toMatchObject({ mietstation: "st1", fahrzeugklasse: "kl1", buchung: rechnerBuchungFeld(b, anteil) });
    expect(JSON.parse(mit.buchung as string)).toEqual({ id: "b1", von: "2026-11-17", bis: "2026-11-23", station: "st1", klasse: "kl1", anteil_eur: 112.5, inklusiv_km: 200, mehrkm_satz_eur: 0.38 });
    expect(eingabeHash(mit)).not.toBe(eingabeHash(basis));
    expect(basis.mietstation).toBe("alt");
  });
});

import { describe, expect, it } from "vitest";
import { befehlAus } from "./freigabe-befehle";
import { antwortAus, neuerCode, RUECKFRAGE_CODE_RE, rueckfrageNachricht, validiereRueckfragen, waehleRueckfrage } from "./rueckfragen-befehle";

describe("Rückfragen", () => {
  it("Codes liegen außerhalb der Freigabe-Grammatik", () => {
    for (let i = 0; i < 300; i += 1) {
      const code = neuerCode(new Set());
      expect(code).toMatch(/^[G-HJ-NP-Z][G-HJ-NP-Z2-9]{3}$/);
      expect(RUECKFRAGE_CODE_RE.test(code)).toBe(true);
      for (const befehl of [`ok ${code}`, `ja ${code}`, `nein ${code}`, `ändern ${code}: x`, `senden ${code}: x`, `regel ${code}-1 ja`]) expect(befehlAus(befehl)).toBeNull();
    }
    expect(neuerCode(new Set(["RRRR"]), () => 0.999)).toBe("Z999");
    let call = 0;
    const sequence = [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
    expect(neuerCode(new Set(["GGGG"]), () => sequence[call++ % sequence.length]!)).not.toBe("GGGG");
    expect(() => neuerCode(new Set(["GGGG"]), () => 0)).toThrow(/kein freier Code/);
  });

  it("antwortAus erkennt Code am Anfang, sonst freien Text", () => {
    expect(antwortAus("#R7K2 privat", ["R7K2"])).toEqual({ code: "R7K2", antwort: "privat" });
    expect(antwortAus("r7k2: Thomas Müller, OKIO Listung", ["R7K2"])).toEqual({ code: "R7K2", antwort: "Thomas Müller, OKIO Listung" });
    expect(antwortAus("R7K2", ["R7K2"])).toEqual({ code: "R7K2", antwort: "" });
    expect(antwortAus("privat", ["R7K2"])).toEqual({ code: null, antwort: "privat" });
    expect(antwortAus("   ", ["R7K2"])).toBeNull();
    expect(antwortAus("ok R7K2", ["R7K2"])).toEqual({ code: null, antwort: "ok R7K2" });
  });

  it("antwortAus: ein bekannter alter Code zählt als Code, ein Wort im Code-Alphabet nicht", () => {
    expect(antwortAus("M9ZZ privat", ["R7K2"], ["M9ZZ"])).toEqual({ code: "M9ZZ", antwort: "privat" });
    expect(antwortAus("Kurt Meyer, Baustelle", ["R7K2"], ["M9ZZ"])).toEqual({ code: null, antwort: "Kurt Meyer, Baustelle" });
    expect(antwortAus("R7K2x privat", ["R7K2"])).toEqual({ code: null, antwort: "R7K2x privat" });
  });

  it("waehleRueckfrage: eindeutig, mehrdeutig, kein Treffer", () => {
    const offene = [{ id: "1", code: "R7K2" }, { id: "2", code: "M9ZZ" }];
    expect(waehleRueckfrage(offene, { code: "M9ZZ" })).toEqual({ treffer: offene[1] });
    expect(waehleRueckfrage(offene, { code: null })).toEqual({ fehler: "mehrdeutig" });
    expect(waehleRueckfrage([offene[0]!], { code: null })).toEqual({ treffer: offene[0] });
    expect(waehleRueckfrage(offene, { code: "XXXX" })).toEqual({ fehler: "kein_treffer" });
    expect(waehleRueckfrage([], { code: null })).toEqual({ fehler: "keine_offen" });
    expect(waehleRueckfrage([], { code: "M9ZZ" })).toEqual({ fehler: "kein_treffer" });
  });

  it("Nachricht bündelt Fragen mit Code und Optionen, ohne Gedankenstriche", () => {
    const text = rueckfrageNachricht("kassensturz", [
      { code: "R7K2", frage: "Restaurant Pampa, 86,40 Euro, Mi 21.10., Amex Kottke: Wer war dabei, welcher Anlass? Oder: privat.", optionen: ["privat"] },
      { code: "M9ZZ", frage: "Eingang 1.670,00 Euro: Kunde, Umbuchung oder etwas anderes?", optionen: [] },
    ]);
    expect(text).toMatch(/^Rückfragen von Kassensturz \(2\):/);
    expect(text).toContain("#R7K2 Restaurant Pampa");
    expect(text).toContain("Antwort: R7K2 privat / R7K2 <Text>");
    expect(text).toContain("Antwort: M9ZZ <Text>");
    expect(text).not.toMatch(/[–—]/);
    expect(rueckfrageNachricht("anderes-werkzeug", [{ code: "R7K2", frage: "x", optionen: [] }])).toMatch(/^Rückfrage von anderes-werkzeug:/);
  });

  it("validiereRueckfragen setzt Vorgaben und lehnt Müll ab", () => {
    expect(validiereRueckfragen({ quelle: "kassensturz", fragen: [{ frage: "Wer?", optionen: ["privat"] }] })).toEqual({ ok: true, value: { quelle: "kassensturz", fragen: [{ frage: "Wer?", optionen: ["privat"], ablaufTage: 7 }] } });
    expect(validiereRueckfragen({ quelle: "kassensturz", empfaenger: "Dario", fragen: [{ frage: "Wer?", optionen: [], payload: { tx_id: "a1", kind: "bewirtung" }, ablaufTage: 3 }] })).toEqual({ ok: true, value: { quelle: "kassensturz", empfaenger: "Dario", fragen: [{ frage: "Wer?", optionen: [], payload: { tx_id: "a1", kind: "bewirtung" }, ablaufTage: 3 }] } });
    for (const body of [
      { quelle: "Kassen Sturz", fragen: [{ frage: "a", optionen: [] }] },
      { quelle: "x", fragen: [] },
      { quelle: "x", fragen: new Array(11).fill({ frage: "a", optionen: [] }) },
      { quelle: "x", fragen: [{ frage: "", optionen: [] }] },
      { quelle: "x", fragen: [{ frage: "a".repeat(501), optionen: [] }] },
      { quelle: "x", fragen: [{ frage: "a", optionen: new Array(9).fill("o") }] },
      { quelle: "x", fragen: [{ frage: "a", optionen: ["o".repeat(41)] }] },
      { quelle: "x", fragen: [{ frage: "a", optionen: [], ablaufTage: 31 }] },
      { quelle: "x", fragen: [{ frage: "a", optionen: [], payload: "nein" }] },
      { quelle: "x", empfaenger: "e".repeat(41), fragen: [{ frage: "a", optionen: [] }] },
      null,
      "text",
    ]) expect(validiereRueckfragen(body).ok).toBe(false);
  });
});

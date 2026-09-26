import { describe, expect, it } from "vitest";
import type { LeadDaten } from "./eingabe";
import type { RechnerAntwort } from "./client";
import { ensureDealCalculation, type KalkulationsSpeicher, type KalkulationsZeile } from "./kalkulation";

const lead = (zimmer: number): LeadDaten => ({
  von: "Böblingen", nach: null, etageVon: 0, etageNach: null, zugangVon: null, zugangNach: null,
  umzugsdatum: null, wohnflaecheQm: null, zimmer, tragestreckeVonM: null, tragestreckeNachM: null,
  halteverbot: false, packService: false, kartons: null, inventar: [],
});

function aufbau(start = new Date("2026-10-01T08:00:00Z")) {
  const zeilen = new Map<string, KalkulationsZeile>();
  const speicher: KalkulationsSpeicher = {
    lesen: async (id) => zeilen.get(id) ?? null,
    speichern: async (z) => { zeilen.set(z.dealRecordId, z); },
  };
  let jetzt = start;
  let aufrufe = 0;
  let naechsteAntwort: RechnerAntwort = { ok: true, ergebnis: { preis: { festpreis: 900 } } };
  let aktuellerLead = lead(3);
  const deps = {
    speicher,
    jetzt: () => jetzt,
    ladeLead: async () => aktuellerLead,
    rechner: async () => { aufrufe += 1; return naechsteAntwort; },
  };
  return {
    zeilen, deps,
    get aufrufe() { return aufrufe; },
    spaeter: (sekunden: number) => { jetzt = new Date(jetzt.getTime() + sekunden * 1000); },
    setzeLead: (l: LeadDaten) => { aktuellerLead = l; },
    setzeAntwort: (a: RechnerAntwort) => { naechsteAntwort = a; },
  };
}

describe("ensureDealCalculation", () => {
  it("rechnet beim ersten Mal und speichert das Ergebnis", async () => {
    const t = aufbau();
    const r = await ensureDealCalculation("ws", "deal1", t.deps);
    expect(r.status).toBe("neu");
    expect(t.zeilen.get("deal1")?.result).toEqual({ preis: { festpreis: 900 } });
    expect(t.aufrufe).toBe(1);
  });

  it("gleiche Eingabe: keine neue Rechnung (unverändert)", async () => {
    const t = aufbau();
    await ensureDealCalculation("ws", "deal1", t.deps);
    t.spaeter(600);
    const r = await ensureDealCalculation("ws", "deal1", t.deps);
    expect(r.status).toBe("unveraendert");
    expect(t.aufrufe).toBe(1);
  });

  it("geänderte Eingabe innerhalb von 60 s wird gedrosselt, mit force trotzdem gerechnet", async () => {
    const t = aufbau();
    await ensureDealCalculation("ws", "deal1", t.deps);
    t.spaeter(20);
    t.setzeLead(lead(4));
    expect((await ensureDealCalculation("ws", "deal1", t.deps)).status).toBe("gedrosselt");
    expect(t.aufrufe).toBe(1);
    expect((await ensureDealCalculation("ws", "deal1", { ...t.deps, force: true })).status).toBe("neu");
    expect(t.aufrufe).toBe(2);
  });

  it("geänderte Eingabe nach 60 s wird neu gerechnet", async () => {
    const t = aufbau();
    await ensureDealCalculation("ws", "deal1", t.deps);
    t.spaeter(61);
    t.setzeLead(lead(4));
    expect((await ensureDealCalculation("ws", "deal1", t.deps)).status).toBe("neu");
  });

  it("Rechnerfehler: Fehler gespeichert, letztes gutes Ergebnis bleibt, später erneuter Versuch", async () => {
    const t = aufbau();
    await ensureDealCalculation("ws", "deal1", t.deps);
    t.spaeter(61);
    t.setzeLead(lead(4));
    t.setzeAntwort({ ok: false, fehler: "Rechner nicht erreichbar." });
    const r = await ensureDealCalculation("ws", "deal1", t.deps);
    expect(r.status).toBe("fehler");
    expect(t.zeilen.get("deal1")).toMatchObject({ error: "Rechner nicht erreichbar.", result: { preis: { festpreis: 900 } } });
    // Gleiche Eingabe nach einem Fehler gilt nicht als unverändert.
    t.spaeter(61);
    t.setzeAntwort({ ok: true, ergebnis: { preis: { festpreis: 950 } } });
    expect((await ensureDealCalculation("ws", "deal1", t.deps)).status).toBe("neu");
    expect(t.zeilen.get("deal1")).toMatchObject({ error: null, result: { preis: { festpreis: 950 } } });
  });

  it("parallele Aufrufe für denselben Lead: eine Rechnung, eine Zeile", async () => {
    const t = aufbau();
    const [a, b] = await Promise.all([
      ensureDealCalculation("ws", "deal1", t.deps),
      ensureDealCalculation("ws", "deal1", t.deps),
    ]);
    expect(t.aufrufe).toBe(1);
    expect(t.zeilen.size).toBe(1);
    expect([a.status, b.status]).toContain("neu");
  });

  it("Lead nicht ladbar: Status fehler, nichts gespeichert, kein Aufruf", async () => {
    const t = aufbau();
    const r = await ensureDealCalculation("ws", "deal1", { ...t.deps, ladeLead: async () => null });
    expect(r).toEqual({ status: "fehler", kalkulation: null });
    expect(t.aufrufe).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import {
  FOTOS_JE_LAUF, GLEICHZEITIG, alarmText, fotoStandBerechnen, inStapel, nacheinanderJe, planeLauf, teilSchluessel,
} from "./inventar-fotos";

const JETZT = new Date("2026-10-09T12:00:00Z");
const vor = (minuten: number) => new Date(JETZT.getTime() - minuten * 60_000);

const offen = (id: number, fotos: number, deal = "deal-1", createdAt = vor(30)) => ({
  id,
  workspaceId: "ws",
  dealRecordId: deal,
  createdAt,
  payload: { attachmentIds: Array.from({ length: fotos }, (_, i) => `f${id}-${i}`) },
});
const ev = (eventType: string, bezug: number, createdAt = vor(20), extra: Record<string, unknown> = {}) => ({
  eventType,
  createdAt,
  payload: { bezug, ...extra },
});
const plan = (o: ReturnType<typeof offen>[], s: ReturnType<typeof ev>[] = []) => planeLauf({ offen: o, spaeter: s, jetzt: JETZT });

describe("inStapel", () => {
  it("teilt in Stapel der Laufgröße", () => {
    expect(inStapel(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });
  it("leere Liste: keine Stapel", () => {
    expect(inStapel([], 2)).toEqual([]);
  });
  it("ein Foto je Stapel, vier gleichzeitig (2 Fotos brauchten bis 281 s, 1 Foto mit Effort low 28 bis 67 s)", () => {
    expect(FOTOS_JE_LAUF).toBe(1);
    expect(GLEICHZEITIG).toBe(4);
  });
});

describe("planeLauf", () => {
  it("nimmt bis zu vier offene Einzelfotos, abwechselnd je Lead", () => {
    const p = plan([offen(1, 1, "a"), offen(2, 1, "a"), offen(3, 1, "a"), offen(4, 1, "a"), offen(5, 1, "b")]);
    expect(p.naechste.map((o) => o.id)).toEqual([1, 5, 2, 3]);
    expect(p.aufteilen).toEqual([]);
    expect(p.aufgeben).toEqual([]);
  });
  it("Mehrfoto-Stapel ohne Versuch wird aufgeteilt, nicht analysiert", () => {
    const p = plan([offen(1, 13)]);
    expect(p.aufteilen.map((o) => o.id)).toEqual([1]);
    expect(p.naechste).toEqual([]);
  });
  it("Mehrfoto-Stapel nach zwei Fehlversuchen wird aufgeteilt statt aufgegeben (Fall Jonas)", () => {
    const p = plan([offen(1, 2)], [ev("fotos_versuch", 1), ev("fotos_fehler", 1), ev("fotos_versuch", 1), ev("fotos_fehler", 1)]);
    expect(p.aufteilen.map((o) => o.id)).toEqual([1]);
    expect(p.aufgeben).toEqual([]);
  });
  it("auch ein schon gemeldeter Mehrfoto-Stapel wird noch aufgeteilt", () => {
    const p = plan([offen(1, 2)], [ev("fotos_versuch", 1), ev("fotos_versuch", 1), ev("fotos_aufgegeben", 1)]);
    expect(p.aufteilen.map((o) => o.id)).toEqual([1]);
  });
  it("Einzelfoto nach zwei Versuchen ohne Ergebnis wird aufgegeben und gemeldet", () => {
    const p = plan([offen(1, 1), offen(2, 1)], [ev("fotos_versuch", 1), ev("fotos_fehler", 1), ev("fotos_versuch", 1), ev("fotos_fehler", 1)]);
    expect(p.aufgeben.map((o) => o.id)).toEqual([1]);
    expect(p.naechste.map((o) => o.id)).toEqual([2]);
  });
  it("laufender Versuch: weder neu starten noch aufgeben noch aufteilen", () => {
    const p = plan(
      [offen(1, 1), offen(2, 1), offen(3, 2)],
      [ev("fotos_versuch", 1, vor(2)), ev("fotos_versuch", 2, vor(20)), ev("fotos_fehler", 2, vor(18)), ev("fotos_versuch", 2, vor(1)), ev("fotos_versuch", 3, vor(3))]
    );
    expect(p.naechste).toEqual([]);
    expect(p.aufgeben).toEqual([]);
    expect(p.aufteilen).toEqual([]);
  });
  it("abgebrochener Versuch ohne Ergebnis wird nach der Sperrzeit wiederholt", () => {
    const p = plan([offen(1, 1)], [ev("fotos_versuch", 1, vor(10))]);
    expect(p.naechste.map((o) => o.id)).toEqual([1]);
  });
  it("schon gemeldet oder erledigt: nichts mehr tun", () => {
    const p = plan(
      [offen(1, 1), offen(2, 1)],
      [ev("fotos_versuch", 1), ev("fotos_versuch", 1), ev("fotos_aufgegeben", 1), ev("fotos_erledigt", 2)]
    );
    expect(p.aufgeben).toEqual([]);
    expect(p.naechste).toEqual([]);
  });
});

describe("teilSchluessel", () => {
  it("Teilstapel bekommen einen eigenen Schlüssel, damit ein alter Einzelstapel sie nicht schluckt", () => {
    expect(teilSchluessel("d1", ["a"], 7)).not.toBe(teilSchluessel("d1", ["a"], 8));
    expect(teilSchluessel("d1", ["a"], 7)).toMatch(/^fotos-offen:d1:/);
  });
});

describe("fotoStandBerechnen", () => {
  const stand = (o: ReturnType<typeof offen>[], s: ReturnType<typeof ev>[] = []) => fotoStandBerechnen({ stapel: o, spaeter: s, jetzt: JETZT });

  it("ausgewertete Fotos zählen nicht, frische offene schon", () => {
    expect(stand([offen(1, 1), offen(2, 1)], [ev("fotos_erledigt", 1, vor(5), { analysiert: 1 })])).toEqual({ offen: 1, gescheitert: 0 });
  });
  it("aufgegebenes Einzelfoto zählt als gescheitert", () => {
    expect(stand([offen(1, 1)], [ev("fotos_versuch", 1), ev("fotos_versuch", 1), ev("fotos_aufgegeben", 1)])).toEqual({ offen: 0, gescheitert: 1 });
  });
  it("zwei Fehlschläge zählen als gescheitert, auch bevor die Meldung gebucht ist", () => {
    expect(stand([offen(1, 1)], [ev("fotos_fehler", 1), ev("fotos_fehler", 1)])).toEqual({ offen: 0, gescheitert: 1 });
  });
  it("gescheiterter Mehrfoto-Stapel im Fenster gilt als offen, er wird noch aufgeteilt", () => {
    expect(stand([offen(1, 2)], [ev("fotos_fehler", 1), ev("fotos_fehler", 1), ev("fotos_aufgegeben", 1)])).toEqual({ offen: 2, gescheitert: 0 });
  });
  it("Stapel älter als 24 Stunden ohne Ergebnis: gescheitert, der Cron fasst ihn nicht mehr an", () => {
    expect(stand([offen(1, 2, "deal-1", vor(25 * 60))])).toEqual({ offen: 0, gescheitert: 2 });
  });
  it("nachgeholtes Foto: späteres Ergebnis gewinnt über den alten gescheiterten Stapel", () => {
    const alt = offen(1, 2, "deal-1", vor(48 * 60));
    const neu = { ...offen(2, 1), payload: { attachmentIds: ["f1-0"] } };
    expect(stand([alt, neu], [ev("fotos_aufgegeben", 1, vor(47 * 60)), ev("fotos_erledigt", 2, vor(5), { analysiert: 1 })])).toEqual({ offen: 0, gescheitert: 1 });
  });
  it("aufgeteilter Stapel zählt nicht selbst, seine Teile schon", () => {
    const eltern = offen(1, 2);
    const teil = { ...offen(2, 1), payload: { attachmentIds: ["f1-0"] } };
    expect(stand([eltern, teil], [ev("fotos_erledigt", 1, vor(10), { aufgeteilt: 2 })])).toEqual({ offen: 1, gescheitert: 0 });
  });
});

describe("nacheinanderJe", () => {
  it("gleicher Schlüssel läuft nacheinander, anderer Schlüssel daneben", async () => {
    const nacheinander = nacheinanderJe();
    const log: string[] = [];
    let freigeben: () => void = () => {};
    const erster = nacheinander("a", () => new Promise<void>((r) => { log.push("a1 start"); freigeben = () => { log.push("a1 ende"); r(); }; }));
    const zweiter = nacheinander("a", async () => { log.push("a2"); });
    const anderer = nacheinander("b", async () => { log.push("b1"); });
    await anderer;
    expect(log).toEqual(["a1 start", "b1"]);
    freigeben();
    await Promise.all([erster, zweiter]);
    expect(log).toEqual(["a1 start", "b1", "a1 ende", "a2"]);
  });
  it("ein Fehler im ersten Schritt hält den nächsten nicht auf", async () => {
    const nacheinander = nacheinanderJe();
    const erster = nacheinander("a", async () => { throw new Error("kaputt"); });
    const zweiter = nacheinander("a", async () => "ok");
    await expect(erster).rejects.toThrow("kaputt");
    await expect(zweiter).resolves.toBe("ok");
  });
});

describe("alarmText", () => {
  it("nennt Auftrag, Fotozahl und was zu tun ist", () => {
    const t = alarmText({ bezeichnung: "Auftrag 2026-074, Beatrice Fallscheer", fotos: 13, fehler: null });
    expect(t).toContain("Beatrice Fallscheer");
    expect(t).toContain("13 Fotos");
    expect(t).toContain("Umzugsgut");
    expect(t).not.toMatch(/[—–]/);
  });
});

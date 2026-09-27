import { describe, expect, it } from "vitest";
import { waehleWiederholung, workerDarfExtrahieren, type InventarVersuch } from "./inventar-wiederholung";

const jetzt = new Date("2026-09-27T12:00:00Z");
const vor = (min: number) => new Date(jetzt.getTime() - min * 60_000);
const v = (deal: string, minVorher: number, status: InventarVersuch["status"] = "fehler", ws = "ws"): InventarVersuch =>
  ({ workspaceId: ws, dealRecordId: deal, createdAt: vor(minVorher), status });
const ok = (deal: string, minVorher: number) => ({ workspaceId: "ws", dealRecordId: deal, createdAt: vor(minVorher) });

describe("waehleWiederholung", () => {
  it("nimmt den fälligen Deal, dessen letzter Versuch am längsten her ist", () => {
    expect(waehleWiederholung([v("a", 20), v("b", 90)], jetzt)[0]).toEqual({ workspaceId: "ws", dealRecordId: "b", versuche: 1 });
    expect(waehleWiederholung([v("a", 20), v("b", 90)], jetzt).map((k) => k.dealRecordId)).toEqual(["b", "a"]);
  });
  it("wartet 15 Minuten nach dem letzten Versuch", () => {
    expect(waehleWiederholung([v("a", 10)], jetzt)).toEqual([]);
    expect(waehleWiederholung([v("a", 200), v("a", 5)], jetzt)).toEqual([]);
  });
  it("hört nach 3 Fehlversuchen in 24 Stunden auf", () => {
    expect(waehleWiederholung([v("a", 300), v("a", 200), v("a", 100)], jetzt)).toEqual([]);
    expect(waehleWiederholung([v("a", 200), v("a", 100)], jetzt)[0]!.versuche).toBe(2);
  });
  it("ein abgebrochener Lauf (Status läuft) zählt als Fehlversuch", () => {
    expect(waehleWiederholung([v("a", 300, "laeuft"), v("a", 200, "laeuft"), v("a", 100, "laeuft")], jetzt)).toEqual([]);
    expect(waehleWiederholung([v("a", 30, "laeuft")], jetzt)[0]!.versuche).toBe(1);
  });
  it("ist der letzte Versuch geglückt, leer oder nicht möglich, ist nichts zu tun", () => {
    expect(waehleWiederholung([v("a", 100), v("a", 50, "ok")], jetzt)).toEqual([]);
    expect(waehleWiederholung([v("a", 100), v("a", 50, "leer")], jetzt)).toEqual([]);
    expect(waehleWiederholung([v("a", 50, "nicht_moeglich")], jetzt)).toEqual([]);
  });
  it("ein späteres ai.inventory_extracted (z. B. von Hand angestoßen) erledigt den Deal", () => {
    expect(waehleWiederholung([v("a", 100)], jetzt, [ok("a", 50)])).toEqual([]);
    expect(waehleWiederholung([v("a", 100)], jetzt, [ok("a", 150)])).toHaveLength(1);
  });
  it("Versuche älter als 24 Stunden zählen nicht", () => {
    expect(waehleWiederholung([v("a", 25 * 60)], jetzt)).toEqual([]);
  });
  it("gleiche Deal-ID in zwei Workspaces sind zwei Deals", () => {
    const r = waehleWiederholung([v("a", 300), v("a", 200), v("a", 100), v("a", 30, "fehler", "ws2")], jetzt);
    expect(r).toEqual([{ workspaceId: "ws2", dealRecordId: "a", versuche: 1 }]);
  });
});

describe("workerDarfExtrahieren", () => {
  it("ohne Versuche oder nach geglücktem/leerem Versuch: ja (neue Nachrichten können eine Liste bringen)", () => {
    expect(workerDarfExtrahieren([], jetzt)).toBe(true);
    expect(workerDarfExtrahieren([v("a", 5, "leer")], jetzt)).toBe(true);
    expect(workerDarfExtrahieren([v("a", 5, "ok")], jetzt)).toBe(true);
  });
  it("nach Fehlschlag oder während eines Laufs: nein, dann wiederholt nur der Cron", () => {
    expect(workerDarfExtrahieren([v("a", 60, "ok"), v("a", 5, "fehler")], jetzt)).toBe(false);
    expect(workerDarfExtrahieren([v("a", 2, "laeuft")], jetzt)).toBe(false);
  });
  it("ein Fehlschlag älter als 24 Stunden sperrt nicht mehr", () => {
    expect(workerDarfExtrahieren([v("a", 25 * 60, "fehler")], jetzt)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { FOTOS_JE_LAUF, alarmText, inStapel, planeLauf } from "./inventar-fotos";

const offen = (id: number, fotos: number, deal = "deal-1") => ({
  id,
  workspaceId: "ws",
  dealRecordId: deal,
  payload: { attachmentIds: Array.from({ length: fotos }, (_, i) => `f${id}-${i}`) },
});
const ev = (eventType: string, bezug: number) => ({ eventType, payload: { bezug } });

describe("inStapel", () => {
  it("teilt in Stapel der Laufgröße", () => {
    expect(inStapel(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });
  it("leere Liste: keine Stapel", () => {
    expect(inStapel([], 2)).toEqual([]);
  });
  it("Laufgröße ist 2 (3 Fotos dauerten 261 s bei 270 s Budget)", () => {
    expect(FOTOS_JE_LAUF).toBe(2);
  });
});

describe("planeLauf", () => {
  it("nimmt den ältesten offenen kleinen Stapel", () => {
    const p = planeLauf({ offen: [offen(1, 2), offen(2, 1)], spaeter: [] });
    expect(p.naechster?.id).toBe(1);
    expect(p.aufteilen).toEqual([]);
    expect(p.aufgeben).toEqual([]);
  });
  it("großer Altstapel ohne Versuch wird aufgeteilt, nicht analysiert", () => {
    const p = planeLauf({ offen: [offen(1, 13)], spaeter: [] });
    expect(p.aufteilen.map((o) => o.id)).toEqual([1]);
    expect(p.naechster).toBeNull();
  });
  it("Stapel nach zwei Versuchen ohne Ergebnis wird aufgegeben und gemeldet", () => {
    const p = planeLauf({ offen: [offen(1, 2), offen(2, 1)], spaeter: [ev("fotos_versuch", 1), ev("fotos_versuch", 1)] });
    expect(p.aufgeben.map((o) => o.id)).toEqual([1]);
    expect(p.naechster?.id).toBe(2);
  });
  it("auch ein großer Stapel mit zwei Versuchen wird gemeldet (Fall Beatrice)", () => {
    const p = planeLauf({ offen: [offen(1, 13)], spaeter: [ev("fotos_versuch", 1), ev("fotos_versuch", 1)] });
    expect(p.aufgeben.map((o) => o.id)).toEqual([1]);
    expect(p.aufteilen).toEqual([]);
  });
  it("großer Altstapel nach einem Fehlversuch wird ebenfalls aufgeteilt, nicht vergessen", () => {
    const p = planeLauf({ offen: [offen(1, 13)], spaeter: [ev("fotos_versuch", 1)] });
    expect(p.aufteilen.map((o) => o.id)).toEqual([1]);
  });
  it("schon gemeldet oder erledigt: nichts mehr tun", () => {
    const p = planeLauf({
      offen: [offen(1, 2), offen(2, 2)],
      spaeter: [ev("fotos_versuch", 1), ev("fotos_versuch", 1), ev("fotos_aufgegeben", 1), ev("fotos_erledigt", 2)],
    });
    expect(p.aufgeben).toEqual([]);
    expect(p.naechster).toBeNull();
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

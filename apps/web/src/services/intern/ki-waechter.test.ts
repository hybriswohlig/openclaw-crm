import { describe, expect, it } from "vitest";
import { bewerteKiLage, type WaechterStatus } from "./ki-waechter";

const jetzt = new Date("2026-09-28T10:00:00Z");
const alle = ["Dario", "Ceylan"];
const ok: WaechterStatus = { zustand: "ok", seit: "2026-09-27T00:00:00Z", letzterAlarm: null, nachholen: null };
const gestoert: WaechterStatus = { zustand: "gestoert", seit: "2026-09-28T08:00:00Z", letzterAlarm: "2026-09-28T08:00:00Z", nachholen: null };
const lage = (n: number, f: number, n3 = n, erfolge3 = n - f) => ({
  stunde: { laeufe: n, fehler: f },
  dreiStunden: { laeufe: n3, erfolge: erfolge3 },
  haeufigsterFehler: "crm-tools job error: skill exited with code 1",
});

describe("bewerteKiLage", () => {
  it("Alarm an alle, wenn in der letzten Stunde mind. 5 Läufe und die Hälfte scheitert", () => {
    const r = bewerteKiLage(lage(10, 6), ok, jetzt, 12, alle);
    expect(r.senden?.text).toMatch(/KI-Alarm[\s\S]*6 von 10/);
    expect(r.senden?.an).toEqual(alle);
    expect(r.neuerStatus.zustand).toBe("gestoert");
  });
  it("Alarm, wenn 3 Stunden kein einziger Erfolg bei mind. 3 Läufen", () => {
    expect(bewerteKiLage(lage(2, 2, 4, 0), ok, jetzt, 12, alle).senden?.text).toMatch(/KI-Alarm/);
  });
  it("wenige Läufe oder wenige Fehler: nichts", () => {
    expect(bewerteKiLage(lage(4, 4, 4, 1), ok, jetzt, 12, alle).senden).toBeNull();
    expect(bewerteKiLage(lage(10, 2), ok, jetzt, 12, alle).senden).toBeNull();
    expect(bewerteKiLage(lage(0, 0, 0, 0), ok, jetzt, 12, alle).senden).toBeNull();
  });
  it("während einer Störung erst nach 6 Stunden wieder erinnern", () => {
    expect(bewerteKiLage(lage(10, 8), gestoert, jetzt, 12, alle).senden).toBeNull();
    expect(bewerteKiLage(lage(10, 8), gestoert, new Date("2026-09-28T14:30:00Z"), 16, alle).senden?.text).toMatch(/hält an/);
  });
  it("Entwarnung, wenn es wieder läuft", () => {
    const r = bewerteKiLage(lage(6, 0), gestoert, jetzt, 12, alle);
    expect(r.senden?.text).toMatch(/laufen wieder/);
    expect(r.neuerStatus.zustand).toBe("ok");
  });
  it("Leerlauf nach einer Störung setzt still zurück, damit der nächste Ausfall wieder alarmiert (Review Grok)", () => {
    const r = bewerteKiLage(lage(0, 0, 0, 0), gestoert, jetzt, 12, alle);
    expect(r.senden).toBeNull();
    expect(r.neuerStatus.zustand).toBe("ok");
    const danach = bewerteKiLage(lage(10, 9), r.neuerStatus, new Date("2026-09-28T11:00:00Z"), 13, alle);
    expect(danach.senden?.text).toMatch(/KI-Alarm/);
  });
  it("Quote zwischen Erholung und Alarmgrenze lässt die Störung stehen, kein Alarm alle 15 Minuten (Review Grok, Runde 2)", () => {
    const r = bewerteKiLage(lage(10, 4), gestoert, jetzt, 12, alle);
    expect(r.neuerStatus.zustand).toBe("gestoert");
    expect(r.senden).toBeNull();
    expect(bewerteKiLage(lage(10, 5), r.neuerStatus, new Date("2026-09-28T10:15:00Z"), 12, alle).senden).toBeNull();
  });
  it("nachts wird der Alarm gemerkt und morgens gesendet, auch wenn die Läufe dann aus dem Fenster sind (Review Grok)", () => {
    const nacht = bewerteKiLage(lage(10, 9), ok, new Date("2026-09-28T20:05:00Z"), 22, alle);
    expect(nacht.senden).toBeNull();
    expect(nacht.neuerStatus.zustand).toBe("gestoert");
    expect(nacht.neuerStatus.nachholen?.text).toMatch(/KI-Alarm/);
    const morgen = bewerteKiLage(lage(0, 0, 0, 0), nacht.neuerStatus, new Date("2026-09-29T05:00:00Z"), 7, alle);
    expect(morgen.senden?.text).toMatch(/KI-Alarm/);
    expect(morgen.senden?.an).toEqual(alle);
  });
  it("nicht zugestellte Empfänger werden beim nächsten Lauf nachgeholt, nur diese", () => {
    const offen: WaechterStatus = { ...gestoert, nachholen: { text: "⚠️ KI-Alarm CRM", an: ["Ceylan"] } };
    const r = bewerteKiLage(lage(10, 8), offen, jetzt, 12, alle);
    expect(r.senden).toEqual({ text: "⚠️ KI-Alarm CRM", an: ["Ceylan"] });
  });
});

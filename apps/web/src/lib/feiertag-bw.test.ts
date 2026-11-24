import { describe, expect, it } from "vitest";
import {
  feiertageBw,
  istFeiertagBw,
  istSonntag,
  ostersonntag,
  portalTermine,
  wertstoffhofGeschlossen,
  wertstoffhofSperre,
} from "./feiertag-bw";

describe("Feiertage Baden-Württemberg", () => {
  it("Ostern 2026 und die beweglichen Feiertage", () => {
    expect(ostersonntag(2026)).toBe("2026-04-05");
    expect(ostersonntag(2027)).toBe("2027-03-28");
    const tage = feiertageBw(2026);
    expect(tage.has("2026-04-03")).toBe(true);
    expect(tage.has("2026-04-06")).toBe(true);
    expect(tage.has("2026-05-14")).toBe(true);
    expect(tage.has("2026-05-25")).toBe(true);
    expect(tage.has("2026-06-04")).toBe(true);
  });

  it("feste Feiertage: 1.1., 6.1., 1.5., 3.10., 1.11., 25.12., 26.12.", () => {
    for (const tag of ["2026-01-01", "2026-01-06", "2026-05-01", "2026-10-03", "2026-11-01", "2026-12-25", "2026-12-26", "2027-01-01"]) {
      expect(istFeiertagBw(tag)).toBe(true);
    }
  });

  it("nicht landesweit in BW: 8.3., 15.8., 20.9., 31.10., Buß- und Bettag", () => {
    expect(istFeiertagBw("2026-03-08")).toBe(false);
    expect(istFeiertagBw("2026-08-15")).toBe(false);
    expect(istFeiertagBw("2026-09-20")).toBe(false);
    expect(istFeiertagBw("2026-10-31")).toBe(false);
    expect(istFeiertagBw("2026-11-18")).toBe(false);
  });

  it("Sonntag ist zu, ein normaler Werktag und ein Samstag ohne Feiertag sind offen", () => {
    expect(istSonntag("2026-12-27")).toBe(true);
    expect(wertstoffhofGeschlossen("2026-12-27")).toBe(true);
    expect(istFeiertagBw("2026-12-27")).toBe(false);
    expect(wertstoffhofGeschlossen("2026-12-25")).toBe(true);
    expect(wertstoffhofGeschlossen("2026-12-26")).toBe(true);
    expect(wertstoffhofGeschlossen("2026-12-28")).toBe(false);
    expect(wertstoffhofGeschlossen("2026-12-19")).toBe(false);
  });

  it("Sperre nur bei Entrümpelung, und nur für geschlossene Tage", () => {
    expect(wertstoffhofSperre("entruempelung", [{ datum: "2026-12-25" }, { datum: "2026-12-27" }])).toMatch(/2026-12-25/);
    expect(wertstoffhofSperre("entruempelung", [{ datum: "2026-12-28" }])).toBeNull();
    expect(wertstoffhofSperre("umzug", [{ datum: "2026-12-25" }, { datum: "2026-12-27" }])).toBeNull();
    expect(wertstoffhofSperre("kuechenmontage", [{ datum: "2026-01-01" }])).toBeNull();
    expect(wertstoffhofSperre("clearance", [{ datum: "2026-12-27" }])).toMatch(/2026-12-27/);
    expect(wertstoffhofSperre("clearance_move", [{ datum: "2026-12-25" }])).toBeNull();
  });

  it("Portal: Entrümpelung bietet 25.12. und Sonntag 27.12. nicht an, ein Umzug nie als empfohlen", () => {
    const tage = [
      { date: "2026-12-25", isRecommended: true },
      { date: "2026-12-27", isRecommended: false },
      { date: "2026-12-28", isRecommended: false },
    ];
    expect(portalTermine(tage, { serviceType: "clearance" }).map((t) => t.date)).toEqual(["2026-12-28"]);
    const umzug = portalTermine(tage, { serviceType: "move" });
    expect(umzug.map((t) => t.date)).toEqual(["2026-12-25", "2026-12-27", "2026-12-28"]);
    expect(umzug.find((t) => t.isRecommended)).toBeUndefined();
    expect(portalTermine(tage, { serviceType: "clearance", selectedDate: "2026-12-25" }).map((t) => t.date)).toEqual([
      "2026-12-25",
      "2026-12-28",
    ]);
  });
});

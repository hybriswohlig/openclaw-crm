import { describe, expect, it } from "vitest";
import { hebelAusEingabe, hebelAusSpeicher } from "./paket-hebel";

describe("hebelAusEingabe", () => {
  it("fehlt → undefined, gültig → feste Reihenfolge ohne Doppel", () => {
    expect(hebelAusEingabe(undefined)).toBeUndefined();
    expect(hebelAusEingabe([])).toEqual([]);
    expect(hebelAusEingabe(["kueche", "halteverbot", "kueche"])).toEqual(["halteverbot", "kueche"]);
  });

  it("unbekannt oder keine Liste → null", () => {
    expect(hebelAusEingabe(null)).toBeNull();
    expect(hebelAusEingabe("montage")).toBeNull();
    expect(hebelAusEingabe(["montage", "sauna"])).toBeNull();
    expect(hebelAusEingabe([{}])).toBeNull();
  });
});

describe("hebelAusSpeicher", () => {
  it("liest nur bekannte Hebel", () => {
    expect(hebelAusSpeicher(["montage", "alt", "halteverbot"])).toEqual(["halteverbot", "montage"]);
    expect(hebelAusSpeicher(null)).toEqual([]);
  });
});

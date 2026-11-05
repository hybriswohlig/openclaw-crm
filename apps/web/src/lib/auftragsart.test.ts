import { describe, expect, it } from "vitest";
import { auftragsartAus } from "./auftragsart";

describe("auftragsartAus", () => {
  it("macht aus einer Entrümpelungs-Anfrage 'entruempelung'", () => {
    expect(auftragsartAus({ gespeichert: null, leadType: "Entruempelung" })).toBe("entruempelung");
  });
  it("gespeicherte Küche gewinnt gegen den Lead-Typ", () => {
    expect(auftragsartAus({ gespeichert: "kitchen_installation", leadType: "entruempelung" })).toBe("kuechenmontage");
  });
  it("'move' als Spalten-Default zählt nicht als Wahl", () => {
    expect(auftragsartAus({ gespeichert: "move", leadType: "entruempelung" })).toBe("entruempelung");
  });
  it("ohne Hinweise ist es ein Umzug", () => {
    expect(auftragsartAus({ gespeichert: null, leadType: null })).toBe("umzug");
  });
});

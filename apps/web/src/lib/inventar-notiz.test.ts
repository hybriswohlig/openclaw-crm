import { describe, expect, it } from "vitest";
import { kundenNotiz } from "./inventar-notiz";

describe("kundenNotiz", () => {
  it("lässt KI-Zeilen (chat, foto) ganz weg", () => {
    expect(kundenNotiz({ source: "foto", notes: "Auf Foto erkannt, im Chat nicht erwähnt" })).toBe("");
    expect(kundenNotiz({ source: "chat", notes: "steht im Keller" })).toBe("");
  });
  it("behält Team-Notizen, ohne den Maschinentext", () => {
    expect(kundenNotiz({ source: "operator", notes: "Glas, vorsichtig" })).toBe("Glas, vorsichtig");
    expect(kundenNotiz({ source: "operator", notes: "Glasplatte — Auf Foto erkannt, im Chat nicht erwähnt" })).toBe("Glasplatte");
    expect(kundenNotiz({ source: "operator", notes: "Auf Foto erkannt, im Chat nicht erwähnt" })).toBe("");
  });
  it("leer bei fehlender Notiz", () => {
    expect(kundenNotiz({ source: "operator", notes: null })).toBe("");
  });
});

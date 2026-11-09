import { describe, expect, it } from "vitest";
import { anfrageMitUebersteuerungen, pruefeUebersteuerung, type Uebersteuerung } from "@/lib/kalkulation-versionen";
import { grundAusKurzgrund } from "@/lib/kalkulation-p15";
import { hebelAusUebersteuerungen } from "./kv-posten-logik";

const alsUe = (e: ReturnType<typeof hebelAusUebersteuerungen>): Uebersteuerung[] =>
  e.map((x, i) => ({ id: String(i), ...pruefeUebersteuerung({ art: x.art, key: x.key, wert: x.wert, grund: x.grund }), rechnerwert: null, autor: { userId: "u", quelle: "mensch" }, zeit: "t", fotoRef: null }));

describe("„×“ an Hebel-Posten (Bauteil 6)", () => {
  const basis = { von_halteverbot: "on", nach_halteverbot: "on", einpack_kartons: "15" };
  const ref = { referenceDate: "2026-11-09" };
  it("Halteverbot: beide Seiten aus", () => {
    const a = anfrageMitUebersteuerungen(basis, alsUe(hebelAusUebersteuerungen("halteverbot", "nicht nötig")), ref);
    expect(a).not.toHaveProperty("von_halteverbot");
    expect(a).not.toHaveProperty("nach_halteverbot");
  });
  it("Einpacken aus, Montage und Küche über hebel_aus", () => {
    const a = anfrageMitUebersteuerungen(
      basis,
      alsUe([...hebelAusUebersteuerungen("einpacken", "g"), ...hebelAusUebersteuerungen("montage", "g"), ...hebelAusUebersteuerungen("kueche", "g")]),
      ref
    );
    expect(a).not.toHaveProperty("einpack_kartons");
    expect(a.hebel_aus).toBe(JSON.stringify(["kueche", "montage"]));
  });
  it("Montage wieder an (true) nimmt den Hebel aus der Liste", () => {
    const ue = alsUe([...hebelAusUebersteuerungen("montage", "g"), { art: "eingabe", key: "hebel.montage", wert: true, grund: "doch" }]);
    expect(anfrageMitUebersteuerungen(basis, ue, ref)).not.toHaveProperty("hebel_aus");
  });
  it("Kurzgrund plus Freitext", () => {
    expect(grundAusKurzgrund("Kunde macht selbst", " Schwager baut ab ")).toBe("Kunde macht selbst: Schwager baut ab");
    expect(grundAusKurzgrund("nicht nötig", "")).toBe("nicht nötig");
  });
});

describe("Review I6: mit Paketen kein hebel_aus", () => {
  it("Paket-Hebel in der Anfrage: Montage und Küche bleiben an", () => {
    const a = anfrageMitUebersteuerungen(
      {},
      alsUe([...hebelAusUebersteuerungen("montage", "g"), ...hebelAusUebersteuerungen("kueche", "g")]),
      { referenceDate: "2026-11-09", paketHebel: { premium: ["montage", "kueche"] } }
    );
    expect(a).not.toHaveProperty("hebel_aus");
  });
});

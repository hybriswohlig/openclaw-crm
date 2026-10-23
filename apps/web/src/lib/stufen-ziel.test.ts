import { describe, expect, it } from "vitest";
import { aktiveZielStufe } from "./stufen-ziel";

// Automatische Stufenwechsel (Kontaktart, Nachfass, Angebot verschickt, KI)
// suchten die Zielstufe nur über die Kategorie, in ungeordneten Zeilen. Die
// englischen Seed-Dubletten tragen dieselbe Kategorie und sind nach der
// Stufen-Bereinigung ausgeblendet: Ein Deal auf „Lost“ fällt aus dem Board.
const stufen = [
  { id: "lost_en", title: "Lost", sortOrder: 7, isActive: false, stageCategory: "lost" },
  { id: "verloren", title: "Verloren", sortOrder: 6, isActive: true, stageCategory: "lost" },
  { id: "planned_en", title: "Planned", sortOrder: 1, isActive: true, stageCategory: "booked" },
  { id: "geplant", title: "Geplant", sortOrder: 3, isActive: true, stageCategory: "booked" },
  { id: "quoted_en", title: "Quoted", sortOrder: 2, isActive: false, stageCategory: "quoted" },
  { id: "alt", title: "Kein Lead", sortOrder: 9, isActive: true, stageCategory: null },
];

describe("aktiveZielStufe", () => {
  it("nimmt nie eine ausgeblendete Stufe", () => {
    expect(aktiveZielStufe(stufen, "lost")?.id).toBe("verloren");
  });

  it("zieht die deutsche Stufe der aktiven englischen Dublette vor", () => {
    expect(aktiveZielStufe(stufen, "booked")?.id).toBe("geplant");
  });

  it("gibt null zurück, wenn nur eine ausgeblendete Stufe passt", () => {
    expect(aktiveZielStufe(stufen, "quoted")).toBeNull();
  });

  it("findet eine Stufe ohne Kategorie über den Titel", () => {
    expect(aktiveZielStufe(stufen, "kein_lead", /^kein lead$/i)?.id).toBe("alt");
  });

  it("behandelt Zeilen ohne isActive als aktiv", () => {
    expect(aktiveZielStufe([{ id: "x", title: "Verloren", stageCategory: "lost" }], "lost")?.id).toBe("x");
  });
});

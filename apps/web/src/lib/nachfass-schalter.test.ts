import { describe, expect, it } from "vitest";
import { nachfassModus, nachfassStand, naechsteRegel, type NachfassStandEingabe } from "./nachfass-schalter";

const frei = {
  stopReason: null,
  stageCategory: "quoted",
  humanOwned: false,
  aiPaused: false,
  dryRun: false,
  autoSendNaechsteRegel: true,
  genugFreigaben: true,
};

describe("nachfassModus", () => {
  it("optout → beendet", () => {
    expect(nachfassModus({ ...frei, stopReason: "optout" })).toEqual({ an: false, modus: "beendet", text: "beendet" });
  });

  it("jeder fremde stop_reason (z. B. kunde_hat_geantwortet) → beendet", () => {
    expect(nachfassModus({ ...frei, stopReason: "kunde_hat_geantwortet" }).modus).toBe("beendet");
  });

  it("Stufe lost oder kein_lead → beendet, auch ohne stop_reason", () => {
    expect(nachfassModus({ ...frei, stageCategory: "lost" })).toEqual({ an: false, modus: "beendet", text: "beendet" });
    expect(nachfassModus({ ...frei, stageCategory: "kein_lead" }).modus).toBe("beendet");
  });

  it("beendet schlägt aus (Stufe lost bei inhaber_aus)", () => {
    expect(nachfassModus({ ...frei, stageCategory: "lost", stopReason: "inhaber_aus" }).modus).toBe("beendet");
  });

  it("inhaber_aus → aus", () => {
    expect(nachfassModus({ ...frei, stopReason: "inhaber_aus" })).toEqual({ an: false, modus: "aus", text: "aus" });
  });

  it("humanOwned → aus · von Hand übernommen", () => {
    expect(nachfassModus({ ...frei, humanOwned: true })).toEqual({
      an: false,
      modus: "aus",
      text: "aus · von Hand übernommen",
    });
  });

  it("stop_reason human_owned → aus · von Hand übernommen", () => {
    expect(nachfassModus({ ...frei, stopReason: "human_owned" }).text).toBe("aus · von Hand übernommen");
  });

  it("ai_paused am Gespräch oder als stop_reason → aus", () => {
    expect(nachfassModus({ ...frei, aiPaused: true })).toEqual({ an: false, modus: "aus", text: "aus" });
    expect(nachfassModus({ ...frei, stopReason: "ai_paused" })).toEqual({ an: false, modus: "aus", text: "aus" });
  });

  it("frei + Dry-Run → entwurf", () => {
    expect(nachfassModus({ ...frei, dryRun: true })).toEqual({
      an: true,
      modus: "entwurf",
      text: "automatisch, Entwurf zur Freigabe",
    });
  });

  it("frei + auto_send + Freigaben → sendet", () => {
    expect(nachfassModus(frei)).toEqual({ an: true, modus: "sendet", text: "automatisch, sendet" });
  });

  it("frei ohne Freigaben → entwurf", () => {
    expect(nachfassModus({ ...frei, genugFreigaben: false }).modus).toBe("entwurf");
  });

  it("frei ohne auto_send der nächsten Regel → entwurf", () => {
    expect(nachfassModus({ ...frei, autoSendNaechsteRegel: false }).modus).toBe("entwurf");
  });
});

describe("naechsteRegel", () => {
  it("erste nicht gesendete Regel, null wenn alle gesendet", () => {
    const d = new Date("2026-11-01T10:00:00Z");
    expect(naechsteRegel({ fu1SentAt: null, fu2SentAt: null, closeSentAt: null })).toBe("a1");
    expect(naechsteRegel({ fu1SentAt: d, fu2SentAt: null, closeSentAt: null })).toBe("a2");
    expect(naechsteRegel({ fu1SentAt: d, fu2SentAt: d, closeSentAt: null })).toBe("a3");
    expect(naechsteRegel({ fu1SentAt: d, fu2SentAt: d, closeSentAt: d })).toBeNull();
  });
});

describe("nachfassStand", () => {
  const aus = { autoSend: false, genugFreigaben: false };
  const voll = { autoSend: true, genugFreigaben: true };
  const basis: NachfassStandEingabe = {
    stopReason: null,
    stageCategory: "quoted",
    humanOwned: false,
    aiPaused: false,
    dryRun: false,
    gesendet: { fu1SentAt: null, fu2SentAt: null, closeSentAt: null },
    angebotAm: new Date("2026-11-02T09:00:00.000Z"),
    regeln: { a1: aus, a2: aus, a3: aus },
  };

  it("Tag 2/7/10 aus fu1/fu2/close, geplant = Angebot + 2/7/10 Tage", () => {
    const s = nachfassStand({
      ...basis,
      gesendet: { fu1SentAt: new Date("2026-11-04T10:00:00.000Z"), fu2SentAt: null, closeSentAt: null },
    });
    expect(s.modus).toBe("entwurf");
    expect(s.regeln).toEqual([
      { tag: 2, gesendetAm: "2026-11-04T10:00:00.000Z", geplantAm: null, art: "entwurf" },
      { tag: 7, gesendetAm: null, geplantAm: "2026-11-09T09:00:00.000Z", art: "entwurf" },
      { tag: 10, gesendetAm: null, geplantAm: "2026-11-12T09:00:00.000Z", art: "entwurf" },
    ]);
  });

  it("nächste Regel entscheidet über sendet; art auto nur bei Regeln mit sendet-Bedingungen", () => {
    const s = nachfassStand({
      ...basis,
      gesendet: { fu1SentAt: new Date("2026-11-04T10:00:00.000Z"), fu2SentAt: null, closeSentAt: null },
      regeln: { a1: aus, a2: voll, a3: { autoSend: true, genugFreigaben: false } },
    });
    expect(s).toMatchObject({ an: true, modus: "sendet", text: "automatisch, sendet" });
    expect(s.regeln.map((r) => r.art)).toEqual(["entwurf", "auto", "entwurf"]);
  });

  it("auto_send nur an einer späteren Regel → entwurf", () => {
    const s = nachfassStand({ ...basis, regeln: { a1: aus, a2: voll, a3: voll } });
    expect(s.modus).toBe("entwurf");
    expect(s.regeln.map((r) => r.art)).toEqual(["entwurf", "auto", "auto"]);
  });

  it("Dry-Run: nie sendet, nie auto", () => {
    const s = nachfassStand({ ...basis, dryRun: true, regeln: { a1: voll, a2: voll, a3: voll } });
    expect(s.modus).toBe("entwurf");
    expect(s.regeln.every((r) => r.art === "entwurf")).toBe(true);
  });

  it("aus oder beendet: kein geplantAm, art entwurf", () => {
    for (const stopReason of ["inhaber_aus", "optout"]) {
      const s = nachfassStand({ ...basis, stopReason, regeln: { a1: voll, a2: voll, a3: voll } });
      expect(s.an).toBe(false);
      expect(s.regeln.every((r) => r.geplantAm === null && r.art === "entwurf")).toBe(true);
    }
  });

  it("ohne Angebotsdatum kein geplantAm", () => {
    const s = nachfassStand({ ...basis, angebotAm: null });
    expect(s.regeln.map((r) => r.geplantAm)).toEqual([null, null, null]);
  });

  it("alle Regeln gesendet → entwurf (keine nächste Regel)", () => {
    const d = new Date("2026-11-04T10:00:00.000Z");
    const s = nachfassStand({
      ...basis,
      gesendet: { fu1SentAt: d, fu2SentAt: d, closeSentAt: d },
      regeln: { a1: voll, a2: voll, a3: voll },
    });
    expect(s.modus).toBe("entwurf");
    expect(s.regeln.map((r) => r.geplantAm)).toEqual([null, null, null]);
  });
});

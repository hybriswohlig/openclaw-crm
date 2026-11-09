import { describe, expect, it } from "vitest";
import { ZUORDNUNG } from "@/lib/dunkel-abschaltung";
import {
  VON_HAND,
  abgelehnteNachQuelle,
  abgelehntPunkt,
  argumenteLesen,
  offeneZiele,
  quotationGesperrtSeit,
  umgeleiteteAufrufe,
  type AufrufZeile,
} from "../../../scripts/alte-seiten-checkliste-logik";

const tag = (iso: string) => new Date(iso);

describe("argumenteLesen", () => {
  it("verlangt --umleitung-seit und nennt den Aufruf", () => {
    const leer = argumenteLesen([]);
    expect(leer.ok).toBe(false);
    if (!leer.ok) {
      expect(leer.fehler).toContain("Aufruf:");
      expect(leer.fehler).toContain("--umleitung-seit");
      expect(leer.fehler).toContain("YYYY-MM-DD");
    }
  });

  it("nimmt das Datum aus umleitung-seit.txt, wenn das Argument fehlt (Review M5)", () => {
    const r = argumenteLesen([], "2026-12-01\n");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.wert.umleitungSeit.toISOString().slice(0, 10)).toBe("2026-12-01");
    const arg = argumenteLesen(["--umleitung-seit", "2026-12-05"], "2026-12-01");
    expect(arg.ok && arg.wert.umleitungSeit.toISOString().slice(0, 10)).toBe("2026-12-05");
    const kaputt = argumenteLesen([], "irgendwann");
    expect(kaputt.ok).toBe(false);
    if (!kaputt.ok) expect(kaputt.fehler).toContain("umleitung-seit.txt");
    expect(argumenteLesen([], "   ").ok).toBe(false);
  });

  it("lehnt ungültige Daten ab", () => {
    for (const roh of ["2026-02-31", "2026-13-01", "07.11.2026", "2026-11-09T00:00:00", "gestern", ""]) {
      const r = argumenteLesen(["--umleitung-seit", roh]);
      expect(r.ok, roh).toBe(false);
    }
  });

  it("liest Umleitung, entschiedene offene Pfade und das Okay", () => {
    const r = argumenteLesen([
      "--umleitung-seit",
      "2026-01-15",
      "--entschieden",
      "/email, /tasks",
      "--inhaber-okay",
      "2024-02-29",
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.wert.umleitungSeit.toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(r.wert.entschieden).toEqual(["/email", "/tasks"]);
    expect(r.wert.inhaberOkay?.toISOString()).toBe("2024-02-29T00:00:00.000Z");
  });

  it("lässt entschieden und Okay weg", () => {
    const r = argumenteLesen(["--umleitung-seit", "2026-11-09"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.wert.entschieden).toEqual([]);
    expect(r.wert.inhaberOkay).toBeNull();
  });

  it("nimmt nur offene Ziele aus der Zuordnung", () => {
    const r = argumenteLesen(["--umleitung-seit", "2026-11-09", "--entschieden", "/home"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fehler).toContain("/home");
  });

  it("lehnt unbekannte Argumente ab", () => {
    const r = argumenteLesen(["--umleitung-seit", "2026-11-09", "--tage", "14"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fehler).toContain("--tage");
  });
});

describe("quotationGesperrtSeit", () => {
  const z = (iso: string, stufe: "zaehlen" | "sperren") => ({ am: tag(iso), stufe });

  it("ist null ohne Sperre und wenn das letzte Ereignis wieder zählt", () => {
    expect(quotationGesperrtSeit([])).toBeNull();
    expect(quotationGesperrtSeit([z("2026-01-01T00:00:00Z", "zaehlen")])).toBeNull();
    expect(
      quotationGesperrtSeit([
        z("2026-01-01T00:00:00Z", "sperren"),
        z("2026-02-01T00:00:00Z", "zaehlen"),
      ])
    ).toBeNull();
  });

  it("nimmt die erste Sperre nach dem letzten Zählen", () => {
    const seit = quotationGesperrtSeit([
      z("2026-01-01T00:00:00Z", "zaehlen"),
      z("2026-01-10T00:00:00Z", "sperren"),
      z("2026-01-20T00:00:00Z", "zaehlen"),
      z("2026-02-01T08:00:00Z", "sperren"),
      z("2026-02-02T08:00:00Z", "sperren"),
    ]);
    expect(seit?.toISOString()).toBe("2026-02-01T08:00:00.000Z");
  });

  it("nimmt die erste Sperre, wenn nie gezählt wurde", () => {
    const seit = quotationGesperrtSeit([
      z("2026-03-01T00:00:00Z", "sperren"),
      z("2026-03-02T00:00:00Z", "sperren"),
    ]);
    expect(seit?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("umgeleiteteAufrufe", () => {
  function zeile(teil: { pfad: string; am: string; ui?: AufrufZeile["ui"]; mitAlt?: boolean }): AufrufZeile {
    return {
      pfad: teil.pfad,
      am: tag(teil.am),
      ui: teil.ui ?? null,
      mitAlt: teil.mitAlt ?? false,
    };
  }

  it("zählt nur umgeleitete Pfade mit alt=1 oder Oberfläche neu", () => {
    const gruppen = umgeleiteteAufrufe([
      zeile({ pfad: "/home", am: "2026-11-01T10:00:00Z", mitAlt: true }),
      zeile({ pfad: "/home", am: "2026-11-02T10:00:00Z", ui: "neu" }),
      zeile({ pfad: "/home", am: "2026-11-03T10:00:00Z", ui: "alt" }),
      zeile({ pfad: "/financial", am: "2026-11-01T09:00:00Z", ui: null }),
      zeile({ pfad: "/email", am: "2026-11-01T09:00:00Z", mitAlt: true }),
      zeile({ pfad: "/objects/deals/abc", am: "2026-11-04T12:00:00Z", ui: "neu" }),
      zeile({ pfad: "/tasks", am: "2026-11-01T09:00:00Z", ui: "neu", mitAlt: true }),
      zeile({ pfad: "/inbox", am: "2026-11-05T09:00:00Z", mitAlt: true }),
    ]);
    expect(gruppen).toEqual([
      { pfad: "/home", zahl: 2, letzter: tag("2026-11-02T10:00:00Z") },
      { pfad: "/inbox", zahl: 1, letzter: tag("2026-11-05T09:00:00Z") },
      { pfad: "/objects/deals/abc", zahl: 1, letzter: tag("2026-11-04T12:00:00Z") },
    ]);
  });
});

describe("offene Ziele und abgelehnte PUT", () => {
  it("lässt entschiedene offene Pfade weg und behält die übrigen", () => {
    const alle = ZUORDNUNG.filter((z) => z.neu === null).map((z) => z.alt);
    expect(offeneZiele([])).toEqual(alle);
    expect(offeneZiele(["/email", "/tasks"])).not.toContain("/email");
    expect(offeneZiele(["/email", "/tasks"])).not.toContain("/tasks");
    expect(offeneZiele(["/email", "/tasks"])).toContain("/notes");
  });

  it("zählt abgelehnte Aufrufe der letzten 14 Tage je Quelle", () => {
    const jetzt = tag("2026-11-15T00:00:00Z");
    const gruppen = abgelehnteNachQuelle(
      [
        { am: tag("2026-11-01T00:00:00Z"), quelle: "mcp_werkzeug", abgelehnt: true },
        { am: tag("2026-11-10T00:00:00Z"), quelle: "mcp_werkzeug", abgelehnt: true },
        { am: tag("2026-11-10T01:00:00Z"), quelle: "api_schluessel", abgelehnt: true },
        { am: tag("2026-11-12T00:00:00Z"), quelle: "ui", abgelehnt: false },
        { am: tag("2026-10-01T00:00:00Z"), quelle: "sitzung", abgelehnt: true },
      ],
      jetzt
    );
    // 2026-11-01 liegt genau 14 Tage vor dem Stichtag und zählt mit (`>=`).
    expect(gruppen).toEqual([
      { quelle: "api_schluessel", zahl: 1 },
      { quelle: "mcp_werkzeug", zahl: 2 },
    ]);
  });

  it("formuliert den zusätzlichen offenen Punkt nur bei Ablehnungen", () => {
    expect(abgelehntPunkt(0)).toBeNull();
    expect(abgelehntPunkt(3)).toBe("3 abgelehnte PUT /quotation in 14 Tagen");
  });
});

describe("von Hand prüfen", () => {
  it("nennt Crons, Push, Bots und das Aufgaben-Modul", () => {
    expect(VON_HAND.join("\n")).toMatch(/Crons, Push und Bots/);
    expect(VON_HAND.join("\n")).toMatch(/Aufgaben-Modul/);
    expect(VON_HAND.join("\n")).toMatch(/check-overdue-tasks/);
  });
});

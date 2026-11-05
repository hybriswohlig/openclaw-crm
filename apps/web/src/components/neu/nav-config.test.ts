import { describe, expect, it } from "vitest";
import { HANDY_DOCK, NAV, istAktiv, seitentitel } from "./nav-config";

describe("istAktiv", () => {
  it("markiert den Eintrag auch auf Unterseiten", () => {
    expect(istAktiv("/app/leads/abc", "/app/leads")).toBe(true);
    expect(istAktiv("/app/leads", "/app/leads")).toBe(true);
  });

  it("verwechselt keine Pfade mit gleichem Anfang", () => {
    expect(istAktiv("/app/leadsx", "/app/leads")).toBe(false);
  });

  it("ist ohne Pfad nie aktiv", () => {
    expect(istAktiv(null, "/app/leads")).toBe(false);
  });
});

describe("seitentitel", () => {
  it("nimmt das Label des aktiven Eintrags", () => {
    expect(seitentitel("/app/plan")).toBe("Plan");
    expect(seitentitel("/app/leads/abc")).toBe("Leads");
    expect(seitentitel("/app/einstellungen")).toBe("Einstellungen");
  });

  it("fällt außerhalb der Navigation auf CRM zurück", () => {
    expect(seitentitel("/irgendwas")).toBe("CRM");
  });
});

describe("NAV", () => {
  it("führt Arbeit mit den fünf Kernbereichen in fester Reihenfolge", () => {
    expect(NAV[0].titel).toBe("Arbeit");
    expect(NAV[0].eintraege.map((e) => e.label)).toEqual(["Heute", "Leads", "Plan", "Inbox", "Kasse"]);
  });

  it("führt unter Mehr die übrigen Bereiche unter /app", () => {
    expect(NAV[1].titel).toBe("Mehr");
    expect(NAV[1].eintraege.map((e) => e.href)).toEqual([
      "/app/uebersicht",
      "/app/kunden",
      "/app/mitarbeiter",
      "/app/bewertungen",
      "/app/einstellungen",
    ]);
  });
});

describe("HANDY_DOCK", () => {
  it("zeigt Heute, Leads, Plan, Inbox und Mehr", () => {
    expect(HANDY_DOCK.map((e) => e.label)).toEqual(["Heute", "Leads", "Plan", "Inbox", "Mehr"]);
    expect(HANDY_DOCK[4].href).toBe("/app/mehr");
  });
});

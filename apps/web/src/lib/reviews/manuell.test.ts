import { describe, expect, it } from "vitest";
import {
  BEWERTUNGSLINK_PLATZHALTER,
  STOP_ZEILE_DU,
  STOP_ZEILE_SIE,
  renderManuell,
  textFehler,
  type ManuellLeistung,
} from "./manuell";

const LINK = "https://crm.example.de/r/abcdefgh12345678";
const LEISTUNGEN: [ManuellLeistung, string][] = [
  ["move", "Umzug"],
  ["kitchen_installation", "Küchenmontage"],
  ["clearance", "Entrümpelung"],
  ["clearance_move", "Entrümpelung"],
];

describe("renderManuell", () => {
  it.each(LEISTUNGEN)("%s, Sie: Gruß mit Vorname, Leistungswort, Link, STOP-Zeile zuletzt", (leistung, wort) => {
    const text = renderManuell({ marke: "kottke", vorname: "Anna", link: LINK, leistung, anrede: "sie" });
    expect(text.startsWith("Hallo Anna,\n")).toBe(true);
    expect(text).toContain(wort);
    expect(text).toContain("Google");
    expect(text).toContain(`\n${LINK}\n`);
    expect(text).toContain("Kottke-Team");
    expect(text.split("\n").at(-1)).toBe("Keine Nachrichten mehr? Antworten Sie mit STOP.");
    expect(text).toMatch(/\bSie\b/);
    expect(text).not.toMatch(/\b(du|dein|deine|deinen|deiner)\b/i);
  });

  it.each(LEISTUNGEN)("%s, du: du-Form und du-STOP-Zeile", (leistung, wort) => {
    const text = renderManuell({ marke: "ceylan", vorname: "Mehmet", link: LINK, leistung, anrede: "du" });
    expect(text.startsWith("Hallo Mehmet,\n")).toBe(true);
    expect(text).toContain(wort);
    expect(text).toContain(LINK);
    expect(text).toContain("Ceylan-Team");
    expect(text.split("\n").at(-1)).toBe("Keine Nachrichten mehr? Antworte mit STOP.");
    expect(text).not.toMatch(/\b(Sie|Ihr|Ihre|Ihren|Ihrer|Ihnen)\b/);
  });

  it("Umzug mit Entrümpelung nennt beide Leistungen", () => {
    const text = renderManuell({ marke: "kottke", vorname: null, link: LINK, leistung: "clearance_move", anrede: "sie" });
    expect(text).toContain("Entrümpelung");
    expect(text).toContain("Umzug");
  });

  it.each(["sie", "du"] as const)("ohne Vorname (%s): Gruß ohne Namen", (anrede) => {
    const text = renderManuell({ marke: "kottke", vorname: null, link: LINK, leistung: "move", anrede });
    expect(text.split("\n")[0]).toBe(anrede === "sie" ? "Guten Tag," : "Hallo,");
    const leer = renderManuell({ marke: "kottke", vorname: "   ", link: LINK, leistung: "move", anrede });
    expect(leer.split("\n")[0]).toBe(anrede === "sie" ? "Guten Tag," : "Hallo,");
  });

  it("weder „heute“ noch „wenn alles“, keine Gedankenstriche, über alle Varianten", () => {
    for (const [leistung] of LEISTUNGEN) {
      for (const anrede of ["sie", "du"] as const) {
        for (const marke of ["kottke", "ceylan"] as const) {
          for (const vorname of ["Anna", null]) {
            const text = renderManuell({ marke, vorname, link: LINK, leistung, anrede });
            expect(text.toLowerCase()).not.toContain("heute");
            expect(text.toLowerCase()).not.toContain("wenn alles");
            expect(text.toLowerCase()).not.toContain("geklappt");
            expect(text).not.toMatch(/[–—]/);
            expect(textFehler(text, LINK)).toBeNull();
          }
        }
      }
    }
  });

  it("STOP-Zeilen wörtlich wie vorgegeben", () => {
    expect(STOP_ZEILE_SIE).toBe("Keine Nachrichten mehr? Antworten Sie mit STOP.");
    expect(STOP_ZEILE_DU).toBe("Keine Nachrichten mehr? Antworte mit STOP.");
  });
});

describe("textFehler", () => {
  const gut = renderManuell({ marke: "kottke", vorname: "Anna", link: BEWERTUNGSLINK_PLATZHALTER, leistung: "move", anrede: "sie" });

  it("Vorlage mit Platzhalter ist gültig", () => {
    expect(textFehler(gut, BEWERTUNGSLINK_PLATZHALTER)).toBeNull();
  });

  it("ohne Link → Fehler", () => {
    expect(textFehler(gut.replace(BEWERTUNGSLINK_PLATZHALTER, ""), BEWERTUNGSLINK_PLATZHALTER)).toMatch(/Link/);
  });

  it("ohne STOP-Zeile → Fehler", () => {
    expect(textFehler(gut.replace(STOP_ZEILE_SIE, "Bis bald."), BEWERTUNGSLINK_PLATZHALTER)).toMatch(/STOP/);
  });

  it("leer → Fehler", () => {
    expect(textFehler("   ", BEWERTUNGSLINK_PLATZHALTER)).not.toBeNull();
  });

  it("zu lang → Fehler", () => {
    expect(textFehler(`${gut}\n${"x".repeat(2000)}`, BEWERTUNGSLINK_PLATZHALTER)).toMatch(/lang/);
  });
});

import { describe, expect, it } from "vitest";
import { datenschutzEmailZweck, emailCaptureTexte } from "./email-capture-copy";

describe("emailCaptureTexte", () => {
  it("Kottke, Zeile im Brief: Auftragsbestätigung und Zahlungsbeleg, du", () => {
    const t = emailCaptureTexte("kottke", "missing", "zeile");
    expect(t.headline).toBe(
      "Wohin dürfen wir dir die Auftragsbestätigung und den Zahlungsbeleg schicken?",
    );
    expect(t.headline).not.toContain("Rechnung");
    expect(t.headline).not.toMatch(/\b(Sie|Ihnen|Ihre)\b/);
    expect(t.body).toBe(
      "Damit du deine Auftragsbestätigung und den Zahlungsbeleg per E-Mail erhältst, hinterlege hier bitte deine Adresse.",
    );
  });

  it("Kottke, Kasten und Kleinanzeigen nennen den Zahlungsbeleg", () => {
    expect(emailCaptureTexte("kottke", "missing", "box").headline).toBe(
      "Wir haben noch keine E-Mail von dir.",
    );
    expect(emailCaptureTexte("kottke", "missing", "box").body).toContain("Zahlungsbeleg");
    expect(emailCaptureTexte("kottke", "missing", "box").body).not.toContain("Rechnung");
    const relay = emailCaptureTexte("kottke", "kleinanzeigen_relay", "box");
    expect(relay.headline).toBe("Wir haben dich bisher nur über Kleinanzeigen erreicht.");
    expect(relay.body).toBe(
      "Damit du deine Auftragsbestätigung, den Zahlungsbeleg und weitere Unterlagen direkt erhältst, gib uns kurz deine echte E-Mail-Adresse.",
    );
  });

  it("Ceylan behält Rechnung und Sie", () => {
    expect(emailCaptureTexte("ceylan", "missing", "zeile").headline).toBe(
      "Wohin dürfen wir Auftragsbestätigung und Rechnung schicken?",
    );
    expect(emailCaptureTexte("ceylan", "missing", "box").headline).toContain("Ihnen");
    expect(emailCaptureTexte("ceylan", "missing", "box").body).toContain("Rechnung");
    expect(emailCaptureTexte("ceylan", "kleinanzeigen_relay", "zeile").body).toContain("Rechnung");
    expect(datenschutzEmailZweck("ceylan")).toContain("Auftragsbestätigung und Rechnung");
    expect(datenschutzEmailZweck("ceylan")).toContain("Ihnen");
  });

  it("Datenschutz Kottke: Zahlungsbeleg, du", () => {
    const satz = datenschutzEmailZweck("kottke");
    expect(satz).toContain("Auftragsbestätigung und den Zahlungsbeleg");
    expect(satz).not.toContain("Rechnung");
    expect(satz).toContain("dir");
    expect(satz).not.toMatch(/\b(Sie|Ihnen|Ihre)\b/);
  });
});

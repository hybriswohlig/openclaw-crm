import { describe, expect, it } from "vitest";
import { datenschutzEmailZweck, emailCaptureTexte } from "./email-capture-copy";

describe("emailCaptureTexte", () => {
  it("Kottke, Zeile im Brief: Auftragsbestätigung und Zahlungsbeleg, Sie", () => {
    const t = emailCaptureTexte("kottke", "missing", "zeile");
    expect(t.headline).toBe(
      "Wohin dürfen wir Ihnen die Auftragsbestätigung und den Zahlungsbeleg schicken?",
    );
    expect(t.headline).not.toContain("Rechnung");
    expect(t.body).toBe(
      "Damit Sie Ihre Auftragsbestätigung und den Zahlungsbeleg per E-Mail erhalten, hinterlegen Sie hier bitte Ihre Adresse.",
    );
  });

  it("Kottke, Kasten und Kleinanzeigen nennen den Zahlungsbeleg", () => {
    expect(emailCaptureTexte("kottke", "missing", "box").headline).toBe(
      "Wir haben noch keine E-Mail von Ihnen.",
    );
    expect(emailCaptureTexte("kottke", "missing", "box").body).toContain("Zahlungsbeleg");
    expect(emailCaptureTexte("kottke", "missing", "box").body).not.toContain("Rechnung");
    const relay = emailCaptureTexte("kottke", "kleinanzeigen_relay", "box");
    expect(relay.headline).toBe("Wir haben Sie bisher nur über Kleinanzeigen erreicht.");
    expect(relay.body).toBe(
      "Damit Sie Ihre Auftragsbestätigung, den Zahlungsbeleg und weitere Unterlagen direkt erhalten, geben Sie uns kurz Ihre echte E-Mail-Adresse.",
    );
  });

  it("Ceylan behält Rechnung", () => {
    expect(emailCaptureTexte("ceylan", "missing", "zeile").headline).toBe(
      "Wohin dürfen wir Auftragsbestätigung und Rechnung schicken?",
    );
    expect(emailCaptureTexte("ceylan", "missing", "box").body).toContain("Rechnung");
    expect(emailCaptureTexte("ceylan", "kleinanzeigen_relay", "zeile").body).toContain("Rechnung");
    expect(datenschutzEmailZweck("ceylan")).toContain("Auftragsbestätigung und Rechnung");
  });

  it("Datenschutz Kottke: Zahlungsbeleg, Sie", () => {
    const satz = datenschutzEmailZweck("kottke");
    expect(satz).toContain("Auftragsbestätigung und den Zahlungsbeleg");
    expect(satz).not.toContain("Rechnung");
    expect(satz).toContain("Ihnen");
  });
});

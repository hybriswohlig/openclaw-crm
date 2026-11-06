import { describe, expect, it } from "vitest";
import { betragVorbelegung, bewertungFehlerText, vorlageFehlerText } from "./dialog-texte";

describe("betragVorbelegung", () => {
  it("offener Rest als Euro mit Komma, leer bei 0, null oder negativ", () => {
    expect(betragVorbelegung(198000)).toBe("1980,00");
    expect(betragVorbelegung(50)).toBe("0,50");
    expect(betragVorbelegung(0)).toBe("");
    expect(betragVorbelegung(null)).toBe("");
    expect(betragVorbelegung(-100)).toBe("");
  });
});

describe("bewertungFehlerText", () => {
  it("Konfiguration fehlt: fester Hinweis, sonst die deutsche Meldung des Servers", () => {
    expect(bewertungFehlerText("KONFIGURATION", "NEXT_PUBLIC_APP_URL fehlt")).toBe(
      "Senden ist gerade nicht eingerichtet. Bitte den Admin fragen."
    );
    expect(bewertungFehlerText("FENSTER", "Das 24-Stunden-Fenster von WhatsApp ist geschlossen.")).toBe(
      "Das 24-Stunden-Fenster von WhatsApp ist geschlossen."
    );
    expect(bewertungFehlerText(null, "Der Server hat mit Fehler 500 geantwortet.")).toBe("Der Server hat mit Fehler 500 geantwortet.");
  });
});

describe("vorlageFehlerText", () => {
  it("bekannte englische Fehler der Routen als deutscher Text", () => {
    expect(vorlageFehlerText("Channel account not found")).toBe("Das WhatsApp-Konto gibt es nicht mehr.");
    expect(vorlageFehlerText("Not a WhatsApp channel account")).toBe("Das Konto ist kein WhatsApp-Konto.");
    expect(vorlageFehlerText("Channel account missing WABA id or access token")).toBe(
      "Für dieses Konto fehlen WABA-ID oder Zugangsdaten. Bitte in den Einstellungen prüfen."
    );
    expect(vorlageFehlerText("Channel account missing phone number ID or access token")).toBe(
      "Für dieses Konto fehlen Telefonnummer-ID oder Zugangsdaten. Bitte in den Einstellungen prüfen."
    );
    expect(vorlageFehlerText("Invalid phone number")).toBe("Die Telefonnummer des Kunden ist ungültig.");
    expect(vorlageFehlerText("Failed to fetch templates: (#100) Unsupported get request")).toBe(
      "Meta hat die Vorlagen nicht geliefert: (#100) Unsupported get request"
    );
    expect(vorlageFehlerText("channelAccountId, toPhone, templateName and languageCode are required")).toBe(
      "Konto, Telefonnummer, Vorlage und Sprache müssen gesetzt sein."
    );
    expect(vorlageFehlerText("Cannot determine recipient wa_id")).toBe("Die Telefonnummer des Kunden konnte nicht aufgelöst werden.");
    expect(vorlageFehlerText("WhatsApp template send failed: (#131047) Re-engagement message")).toBe(
      "Vorlage konnte nicht gesendet werden. (#131047) Re-engagement message"
    );
    expect(
      vorlageFehlerText('Template "willkommen" has a IMAGE header. Please set the header media URL for this template in the compose dialog.')
    ).toBe("Die Vorlage braucht ein Kopfbild. Bitte den Bild-Link in der alten Inbox hinterlegen.");
    expect(vorlageFehlerText('Template "doku" uses a DOCUMENT header, which is not yet supported by the CRM.')).toBe(
      "Die Vorlage hat einen Kopf, den das CRM noch nicht unterstützt (nur Bilder)."
    );
  });

  it("Meta-Fehler mit Text, sonst allgemeiner Rückfall", () => {
    expect(vorlageFehlerText("(#132001) Template name does not exist in the translation")).toBe(
      "Vorlage konnte nicht gesendet werden. (#132001) Template name does not exist in the translation"
    );
    expect(vorlageFehlerText("Meta API error 500")).toBe("Vorlage konnte nicht gesendet werden. Meta API error 500");
    expect(vorlageFehlerText("Send failed")).toBe("Vorlage konnte nicht gesendet werden.");
    expect(vorlageFehlerText("")).toBe("Vorlage konnte nicht gesendet werden.");
    expect(vorlageFehlerText("Der Server hat mit Fehler 500 geantwortet.")).toBe("Der Server hat mit Fehler 500 geantwortet.");
    expect(vorlageFehlerText("Keine Verbindung zum Server.")).toBe("Keine Verbindung zum Server.");
  });
});

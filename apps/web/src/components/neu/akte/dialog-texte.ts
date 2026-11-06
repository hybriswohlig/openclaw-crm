/**
 * Reine Texte und Vorbelegungen der Dock-Dialoge (Task 14): Betrag aus dem
 * offenen Rest, Fehlertexte der Bewertungs- und der Vorlage-Route. Kein React,
 * kein Netz.
 */
import { centsToEuroInputValue } from "@/lib/work-ui";

/** Betrag im Zahlungsdialog: offener Rest als „1980,00“, leer ohne oder bei erledigtem Rest. */
export function betragVorbelegung(restCent: number | null): string {
  return restCent !== null && restCent > 0 ? centsToEuroInputValue(restCent) : "";
}

const KONFIGURATION_TEXT = "Senden ist gerade nicht eingerichtet. Bitte den Admin fragen.";

/**
 * Fehler beim Senden der Bewertungsanfrage: die Route antwortet schon deutsch
 * (`services/bewertung-anfragen.ts`), nur `KONFIGURATION` bekommt einen Text
 * ohne den Namen der Umgebungsvariable.
 */
export function bewertungFehlerText(code: string | null, message: string): string {
  return code === "KONFIGURATION" ? KONFIGURATION_TEXT : message;
}

const VORLAGE_ALLGEMEIN = "Vorlage konnte nicht gesendet werden.";

/** Wörtliche englische Fehler aus `inbox-whatsapp.ts` und den Routen. */
const VORLAGE_BEKANNT: Record<string, string> = {
  "Channel account not found": "Das WhatsApp-Konto gibt es nicht mehr.",
  "Not a WhatsApp channel account": "Das Konto ist kein WhatsApp-Konto.",
  "Channel account missing WABA id or access token":
    "Für dieses Konto fehlen WABA-ID oder Zugangsdaten. Bitte in den Einstellungen prüfen.",
  "Channel account missing phone number ID or access token":
    "Für dieses Konto fehlen Telefonnummer-ID oder Zugangsdaten. Bitte in den Einstellungen prüfen.",
  "Invalid phone number": "Die Telefonnummer des Kunden ist ungültig.",
  "Cannot determine recipient wa_id": "Die Telefonnummer des Kunden konnte nicht aufgelöst werden.",
  "channelAccountId, toPhone, templateName and languageCode are required":
    "Konto, Telefonnummer, Vorlage und Sprache müssen gesetzt sein.",
};

/** Englische Präfixe mit Rest, der stehen bleibt (Meta-Antwort). */
const VORLAGE_PRAEFIX: [string, string][] = [
  ["Failed to fetch templates: ", "Meta hat die Vorlagen nicht geliefert: "],
  ["WhatsApp template send failed: ", `${VORLAGE_ALLGEMEIN} `],
];

/** Schon deutsch (eigene Rückfälle aus `api.ts`): unverändert zeigen. */
const DEUTSCH = [/^Der Server hat mit Fehler \d+ geantwortet\.$/, /^Keine Verbindung zum Server\.$/];

/**
 * Fehler der Vorlagen-Routen (`/inbox/channel-accounts/{id}/templates`,
 * `/inbox/whatsapp/send-template`) als deutscher Text. Unbekannte Meta-Fehler
 * („(#132001) …“, „Meta API error 500“) stehen hinter dem allgemeinen Satz,
 * alles andere Unbekannte wird zum allgemeinen Satz allein.
 */
export function vorlageFehlerText(message: string): string {
  const text = message.trim();
  if (text === "") return VORLAGE_ALLGEMEIN;
  const bekannt = VORLAGE_BEKANNT[text];
  if (bekannt) return bekannt;
  for (const [praefix, ersatz] of VORLAGE_PRAEFIX) {
    if (text.startsWith(praefix)) return ersatz + text.slice(praefix.length);
  }
  if (/^Template ".*" has a \w+ header\./.test(text)) {
    return "Die Vorlage braucht ein Kopfbild. Bitte den Bild-Link in der alten Inbox hinterlegen.";
  }
  if (/^Template ".*" uses a \w+ header/.test(text)) {
    return "Die Vorlage hat einen Kopf, den das CRM noch nicht unterstützt (nur Bilder).";
  }
  if (DEUTSCH.some((re) => re.test(text))) return text;
  if (text.includes("(#") || text.startsWith("Meta ")) return `${VORLAGE_ALLGEMEIN} ${text}`;
  return VORLAGE_ALLGEMEIN;
}

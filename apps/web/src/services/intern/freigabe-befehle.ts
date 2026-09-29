/**
 * Befehle, mit denen die internen Nummern Entwürfe per WhatsApp freigeben:
 *   ok CODE                 Entwurf senden (auch "ja")
 *   ändern CODE: Anweisung  KI überarbeitet den Entwurf, neue Fassung kommt
 *                           mit neuem Code zur Freigabe zurück (auch "aendern")
 *   senden CODE: Text       genau dieser Text geht an den Kunden
 *   nein CODE[: Grund]      verwerfen (auch "verwerfen"); der Grund hilft beim Lernen
 * Der Code ist Pflicht: ein "ok" als Antwort auf einen Alarm oder im normalen
 * Chat darf nie einen Entwurf auslösen. Alles andere ist kein Befehl.
 */
export type FreigabeBefehl =
  | { aktion: "ok"; code: string }
  | { aktion: "nein"; code: string; grund?: string }
  | { aktion: "ueberarbeiten"; code: string; anweisung: string }
  | { aktion: "senden"; code: string; text: string };

/** Kurzcode einer Freigabe: die ersten vier Zeichen der Entwurfs-ID. */
export function freigabeCode(draftId: string): string {
  return draftId.replace(/-/g, "").slice(0, 4).toUpperCase();
}

const CODE = String.raw`#?([0-9a-f]{4})`;

export function befehlAus(nachricht: string): FreigabeBefehl | null {
  const t = nachricht.trim();
  if (!t) return null;

  const kurz = new RegExp(String.raw`^(ok|ja)\s+${CODE}\s*[.!]?$`, "i").exec(t);
  if (kurz) return { aktion: "ok", code: kurz[2]!.toUpperCase() };

  const nein = new RegExp(String.raw`^(nein|verwerfen)\s+${CODE}(?:\s*[.!]?\s*$|\s*:\s*([\s\S]+)$)`, "i").exec(t);
  if (nein) {
    const grund = (nein[3] ?? "").trim();
    return grund ? { aktion: "nein", code: nein[2]!.toUpperCase(), grund } : { aktion: "nein", code: nein[2]!.toUpperCase() };
  }

  const mitText = new RegExp(String.raw`^(ändern|aendern|senden)\s+${CODE}\s*:\s*([\s\S]*)$`, "i").exec(t);
  if (mitText) {
    const inhalt = (mitText[3] ?? "").trim();
    if (!inhalt) return null;
    const code = mitText[2]!.toUpperCase();
    return /^senden$/i.test(mitText[1]!)
      ? { aktion: "senden", code, text: inhalt }
      : { aktion: "ueberarbeiten", code, anweisung: inhalt };
  }
  return null;
}

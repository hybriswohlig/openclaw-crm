/**
 * Befehle, mit denen die internen Nummern Entwürfe per WhatsApp freigeben:
 *   ok CODE              senden (auch "ja")
 *   ändern CODE: Text    eigene Fassung senden (auch "aendern")
 *   nein CODE            verwerfen (auch "verwerfen")
 * Der Code ist Pflicht: ein "ok" als Antwort auf einen Alarm oder im normalen
 * Chat darf nie einen Entwurf auslösen. Alles andere ist kein Befehl.
 */
export type FreigabeBefehl =
  | { aktion: "ok"; code: string }
  | { aktion: "nein"; code: string }
  | { aktion: "aendern"; code: string; text: string };

/** Kurzcode einer Freigabe: die ersten vier Zeichen der Entwurfs-ID. */
export function freigabeCode(draftId: string): string {
  return draftId.replace(/-/g, "").slice(0, 4).toUpperCase();
}

const CODE = String.raw`#?([0-9a-f]{4})`;

export function befehlAus(nachricht: string): FreigabeBefehl | null {
  const t = nachricht.trim();
  if (!t) return null;

  const kurz = new RegExp(String.raw`^(ok|ja|nein|verwerfen)\s+${CODE}\s*[.!]?$`, "i").exec(t);
  if (kurz) {
    const aktion = /^(ok|ja)$/i.test(kurz[1]!) ? "ok" : "nein";
    return { aktion, code: kurz[2]!.toUpperCase() };
  }

  const aendern = new RegExp(String.raw`^(?:ändern|aendern)\s+${CODE}\s*:\s*([\s\S]*)$`, "i").exec(t);
  if (aendern) {
    const text = (aendern[2] ?? "").trim();
    if (!text) return null;
    return { aktion: "aendern", code: aendern[1]!.toUpperCase(), text };
  }
  return null;
}

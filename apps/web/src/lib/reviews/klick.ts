/**
 * Klick auf den Bewertungslink `/r/{token}`: wer zählt, und über welchen Kanal
 * kam der Link. Reine Logik, die Route liest und schreibt.
 */

// Link-Vorschauen der Messenger holen die Seite, bevor ein Mensch tippt. Der
// Facebook-In-App-Browser (FBAN/FBAV) ist dagegen ein echter Klick.
const VORSCHAU_AGENTEN = [/\bwhatsapp\//i, /facebookexternalhit/i, /\bfacebot\b/i, /facebookcatalog/i, /telegrambot/i];

export function istVorschauAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return VORSCHAU_AGENTEN.some((m) => m.test(userAgent));
}

export interface VersandEreignis {
  eventType: string;
  channel: string | null;
  meta: unknown;
  at: Date;
}

function kanalAus(e: VersandEreignis): string {
  if (e.channel) return e.channel;
  return e.eventType === "sent_whatsapp" ? "whatsapp" : "sms";
}

function tokenAus(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const t = (meta as { token?: unknown }).token;
  return typeof t === "string" ? t : null;
}

/**
 * Kanal des Versands, zu dem der Token gehört: das `sent_*`-Ereignis mit
 * diesem Token im meta (Bewertung von Hand), sonst das letzte Versandereignis
 * bis zur Anlage des Tokens (die Engine schrieb keinen Token ins meta), sonst
 * „sms“ wie bisher.
 */
export function klickKanal(ereignisse: VersandEreignis[], token: string, tokenAngelegt?: Date): string {
  const versand = ereignisse.filter((e) => e.eventType === "sent_sms" || e.eventType === "sent_whatsapp");
  const genau = versand.find((e) => tokenAus(e.meta) === token);
  if (genau) return kanalAus(genau);
  const bis = tokenAngelegt?.getTime() ?? Number.POSITIVE_INFINITY;
  const davor = versand
    .filter((e) => tokenAus(e.meta) === null && e.at.getTime() <= bis + 60_000)
    .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  return davor ? kanalAus(davor) : "sms";
}

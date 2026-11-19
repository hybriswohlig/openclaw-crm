/**
 * Inventar-Notiz für Kundendokumente (KV, AB, Rechnung). Wunsch Inhaber 19.11.2026:
 * Arbeitskommentare der KI („Auf Foto erkannt, im Chat nicht erwähnt“, Notizen aus Chat-
 * oder Fotoerkennung) gehören nie in ein Kundendokument. Nur was das Team von Hand pflegt
 * (`source = operator`), und auch daraus fallen die Maschinentexte weg. Rein, ohne Datenbank.
 */
export const MASCHINEN_NOTIZEN: readonly RegExp[] = [/auf foto erkannt,?\s*im chat nicht erw(?:ä|ae)hnt/gi];

export function kundenNotiz(item: { source?: string | null; notes?: string | null }): string {
  if (item.source !== "operator") return "";
  let text = item.notes ?? "";
  for (const muster of MASCHINEN_NOTIZEN) text = text.replace(muster, "");
  // Übrig gebliebene Trenner („X — “, „ — “) und Leerraum glätten.
  return text
    .split(/\s+[—–-]\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .join(" — ")
    .trim();
}

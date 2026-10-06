/**
 * AGB einer Firma von crm-tools (Quelle: firmen/<firma>/agb.md auf dem VPS).
 * Die AGB-Seite des Portals und der Nachweis bei der Annahme laden über
 * diese eine Funktion mit derselben Cache-Dauer: Next teilt den Cache-Eintrag,
 * also speichert die Annahme genau den Text, den die Seite gerade zeigt.
 */
export const AGB_CACHE_SEKUNDEN = 300;

export async function ladeAgbHtml(firmaSlug: string): Promise<string | null> {
  const base = process.env.CRM_TOOLS_API_URL ?? "https://crm-tools.kottke.info";
  try {
    const res = await fetch(`${base}/legal/agb/${firmaSlug}`, {
      signal: AbortSignal.timeout(5000),
      next: { revalidate: AGB_CACHE_SEKUNDEN },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html.length >= 500 ? html : null;
  } catch {
    return null;
  }
}

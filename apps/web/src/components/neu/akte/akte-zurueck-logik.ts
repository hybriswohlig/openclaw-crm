/**
 * Ziel von „‹ Leads“ in der Akte am Handy (Plan 10, Entscheidung 9). Rein,
 * damit es ohne Browser testbar ist.
 *
 * „zurueck“ nur, wenn es einen Vorgänger aus der eigenen neuen Oberfläche gibt:
 * Entweder wurde innerhalb dieses Dokuments navigiert (die zuerst geladene
 * Adresse ist nicht die jetzige), oder die Seite kam per Link von einer Seite
 * unter `/app/` desselben Hosts. Sonst (Direktaufruf, Push, Lesezeichen,
 * fremde Seite) geht es auf die Liste.
 */
export const LEADS_LINK = "/app/leads";

export interface ZurueckLage {
  /** `location.href` jetzt. */
  jetzt: string;
  /** Adresse, mit der dieses Dokument geladen wurde (Navigation Timing `name`), oder null. */
  ersteAdresse: string | null;
  /** `document.referrer` (leer, wenn keiner). */
  referrer: string;
  /** `location.origin`. */
  origin: string;
  /** `history.length`. */
  verlaufLaenge: number;
}

export type ZurueckZiel = { art: "zurueck" } | { art: "link"; href: string };

export function akteZurueckZiel(l: ZurueckLage): ZurueckZiel {
  if (l.verlaufLaenge > 1) {
    if (l.ersteAdresse && ohneHash(l.ersteAdresse) !== ohneHash(l.jetzt)) return { art: "zurueck" };
    if (ausNeuerOberflaeche(l.referrer, l.origin)) return { art: "zurueck" };
  }
  return { art: "link", href: LEADS_LINK };
}

function ohneHash(url: string): string {
  const i = url.indexOf("#");
  return i < 0 ? url : url.slice(0, i);
}

function ausNeuerOberflaeche(referrer: string, origin: string): boolean {
  if (!referrer) return false;
  try {
    const u = new URL(referrer);
    return u.origin === origin && u.pathname.startsWith("/app/");
  } catch {
    return false;
  }
}

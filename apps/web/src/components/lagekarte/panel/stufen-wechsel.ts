/**
 * Stufenänderung im Lead-Panel mit sicherem Rückgängig (Release-Review Grok, 2026-10-08).
 *
 * - Je Lead zählt nur die jüngste eigene Änderung. Ein älterer Toast (oder ein zweiter
 *   Klick auf denselben) darf nichts mehr schreiben.
 * - Die vorherige Stufe wird direkt vor dem Schreiben vom Server gelesen, nicht aus den
 *   Kartendaten genommen (die können bis zu 60 s alt sein oder noch nachladen).
 * - Rückgängig schreibt nur, wenn die gespeicherte Stufe noch die ist, die diese Änderung
 *   geschrieben hat; sonst hat inzwischen jemand anderes geändert.
 *
 * Grenze: Lesen und Schreiben sind zwei Anfragen, kein atomarer Vergleich auf dem Server.
 * Das verbleibende Fenster ist die Dauer einer Anfrage.
 */

export interface Schreibung {
  leadId: string;
  nr: number;
}

export interface StufenProtokoll {
  /** Beginnt eine Änderung (auch ein Rückgängig). Ältere Änderungen dieses Leads sind ab jetzt veraltet. */
  beginne(leadId: string): Schreibung;
  /** Markiert die Änderung als abgeschlossen (Erfolg oder Fehler). */
  beende(s: Schreibung): void;
  /** Ist dies die jüngste Änderung an ihrem Lead? */
  istJuengste(s: Schreibung): boolean;
  /** Läuft gerade eine Änderung an diesem Lead? */
  laeuft(leadId: string): boolean;
}

export function erstelleStufenProtokoll(): StufenProtokoll {
  let zaehler = 0;
  const juengste = new Map<string, number>();
  const offen = new Set<number>();
  return {
    beginne(leadId) {
      zaehler += 1;
      juengste.set(leadId, zaehler);
      offen.add(zaehler);
      return { leadId, nr: zaehler };
    },
    beende(s) {
      offen.delete(s.nr);
    },
    istJuengste(s) {
      return juengste.get(s.leadId) === s.nr;
    },
    laeuft(leadId) {
      const nr = juengste.get(leadId);
      return nr !== undefined && offen.has(nr);
    },
  };
}

export type RueckgaengigPruefung =
  | { ok: true }
  | { ok: false; grund: "veraltet" }
  | { ok: false; grund: "fremd"; gespeichert: string | null };

/**
 * Darf ein Rückgängig schreiben? `nach` ist die Stufe, die die rückgängig zu machende
 * Änderung geschrieben hat, `gespeichert` die jetzt gespeicherte Stufe (null = keine).
 */
export function pruefeRueckgaengig(juengste: boolean, gespeichert: string | null, nach: string): RueckgaengigPruefung {
  if (!juengste) return { ok: false, grund: "veraltet" };
  if (gespeichert !== nach) return { ok: false, grund: "fremd", gespeichert };
  return { ok: true };
}

/** Anzeigename einer Stufe für Toasts; null = Lead hatte keine Stufe. */
export function stufenName(id: string | null, stufen: ReadonlyArray<{ id: string; titel: string }>): string {
  if (id === null) return "keine Stufe";
  return stufen.find((s) => s.id === id)?.titel ?? "unbekannte Stufe";
}

/**
 * Liest die gespeicherte Stufe (Status-ID) eines Leads über die Deal-Route; null = keine Stufe.
 * Wirft bei HTTP-Fehlern (mit Meldung) und bei fehlender Verbindung.
 */
export async function leseStufe(leadId: string): Promise<string | null> {
  const res = await fetch(`/api/v1/objects/deals/records/${encodeURIComponent(leadId)}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Stufe konnte nicht gelesen werden (${res.status})`);
  let body: { data?: { values?: Record<string, unknown> } };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new Error("Stufe konnte nicht gelesen werden (ungültige Antwort)");
  }
  const stufe = body.data?.values?.stage;
  return typeof stufe === "string" && stufe !== "" ? stufe : null;
}

/** Wie leseStufe, aber undefined statt Fehler (zum Nachlesen nach einem gescheiterten Schreiben). */
export async function stufeNachlesen(leadId: string): Promise<string | null | undefined> {
  try {
    return await leseStufe(leadId);
  } catch {
    return undefined;
  }
}

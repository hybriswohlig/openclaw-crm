/**
 * Leisten der Transporter-Buchungen im Plan (12b Entscheidung 9), reine Logik:
 * je Woche (sieben Tage Mo bis So) die Abschnitte jeder Buchung mit Spalte,
 * Breite und Bahn, damit sich überlappende Buchungen nicht verdecken.
 */
import { tageZwischen, type PlanBuchung } from "@/lib/einsatz";

export interface LeistenAbschnitt {
  buchung: PlanBuchung;
  /** 1-basierte Startspalte in der Woche (CSS grid-column). */
  spalte: number;
  breite: number;
  /** 1-basierte Bahn (CSS grid-row). */
  bahn: number;
  /** Beginnt die Buchung vor dieser Woche bzw. endet danach? */
  weiterLinks: boolean;
  weiterRechts: boolean;
}

/** Abschnitte einer Woche; `tage` sind die sieben Tage der Zeile in Reihenfolge. */
export function leistenFuerWoche(buchungen: readonly PlanBuchung[], tage: readonly string[]): LeistenAbschnitt[] {
  if (tage.length === 0) return [];
  const erster = tage[0]!;
  const letzter = tage[tage.length - 1]!;
  const sichtbar = buchungen
    .filter((b) => b.von <= letzter && b.bis >= erster)
    .sort((a, b) => a.von.localeCompare(b.von) || b.bis.localeCompare(a.bis) || a.id.localeCompare(b.id));
  const bahnen: number[] = []; // je Bahn die letzte belegte Spalte
  const aus: LeistenAbschnitt[] = [];
  for (const b of sichtbar) {
    const start = Math.max(0, tage.indexOf(b.von < erster ? erster : b.von));
    const ende = tage.indexOf(b.bis > letzter ? letzter : b.bis);
    const bis = ende < 0 ? tage.length - 1 : ende;
    let bahn = bahnen.findIndex((frei) => frei < start);
    if (bahn < 0) {
      bahn = bahnen.length;
      bahnen.push(bis);
    } else bahnen[bahn] = bis;
    aus.push({
      buchung: b,
      spalte: start + 1,
      breite: bis - start + 1,
      bahn: bahn + 1,
      weiterLinks: b.von < erster,
      weiterRechts: b.bis > letzter,
    });
  }
  return aus;
}

/** Ist `tag` von einer nicht stornierten Buchung gedeckt, die den Deal trägt? */
export function buchungDesDeals(buchungen: readonly PlanBuchung[], dealId: string): PlanBuchung | null {
  return buchungen.find((b) => b.dealIds.includes(dealId)) ?? null;
}

/** Satz für die Rückfrage beim Verschieben (12b Entscheidung 9); null, wenn der Tag in der Buchung bleibt. */
export function ausserhalbText(buchungen: readonly PlanBuchung[], dealId: string, zielTag: string): string | null {
  const b = buchungDesDeals(buchungen, dealId);
  if (!b || b.status === "storniert") return null;
  if (b.von <= zielTag && b.bis >= zielTag) return null;
  return `Der Termin liegt dann außerhalb der Buchung ${b.text.replace(/\.$/, "")}.`;
}

/** Vorschlag für die Miete aus den Tagessätzen der Klasse (nur Vorschlag, E5). */
export function mieteVorschlag(
  klasse: { mietpreisWochentage: Record<string, number> | null } | null,
  von: string,
  bis: string,
): number | null {
  if (!klasse?.mietpreisWochentage || bis < von) return null;
  const wt = ["so", "mo", "di", "mi", "do", "fr", "sa"] as const;
  let summe = 0;
  for (const t of tageZwischen(von, bis, 31)) {
    const [j, m, d] = t.split("-").map(Number) as [number, number, number];
    const satz = klasse.mietpreisWochentage[wt[new Date(Date.UTC(j, m - 1, d)).getUTCDay()]!];
    if (typeof satz !== "number" || !Number.isFinite(satz)) return null;
    summe += satz;
  }
  return Math.round(summe * 100);
}

export function kmVorschlag(klasse: { inklusivKmProTag: number | null } | null, von: string, bis: string): number | null {
  if (!klasse || klasse.inklusivKmProTag === null || bis < von) return null;
  return klasse.inklusivKmProTag * tageZwischen(von, bis, 31).length;
}
